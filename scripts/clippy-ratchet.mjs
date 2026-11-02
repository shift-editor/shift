// Clippy for the workspace, with a ratchet for lints that still have hits.
//
// A lint with no hits goes in `[workspace.lints.clippy]`, where CI's
// `-D warnings` blocks it. A lint with hits can't go there yet, so it is listed
// in `clippy-ratchet.json` with today's hits per crate, and this script fails
// when any count rises. Fix some hits, run `pnpm lint:rust-ratchet --update`,
// and commit the lower numbers; once a lint is at 0 everywhere, move it to
// `Cargo.toml`.
//
// One `cargo clippy --workspace --all-targets` run checks everything, with the
// ratcheted lints added as warnings. It fails like `-D warnings` on any other
// warning, so it replaces the plain clippy run, and costs no more.
//
// Counts are split into library and binary code (`src`) and the rest
// (`tests`): integration tests, benches, examples and `#[cfg(test)]` code. A
// library or binary is checked twice, once normally and once as its unit-test
// harness, so a hit both report is `src` and a hit only one reports is test
// code. (A second `--lib --bins` run would say the same but costs ~15 s, since
// dev-dependency features rebuild crates.) clippy.toml lets tests unwrap,
// expect, panic, print and index, so `tests` counts those only in helpers
// clippy doesn't see as tests (outside `#[test]` and `#[cfg(test)]`).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const BASELINE = fileURLToPath(new URL("../clippy-ratchet.json", import.meta.url));
const UPDATE_COMMAND = "pnpm lint:rust-ratchet --update";

/**
 * Runs clippy with each ratcheted lint as a warning.
 *
 * @param {string[]} targets cargo target selection, such as `["--all-targets"]`
 * @param {string[]} lints lint names without the `clippy::` prefix
 * @returns {{ status: number | null, messages: object[] }} the exit status and
 *   cargo's `compiler-message` records
 */
function clippy(targets, lints) {
  const warnings = lints.flatMap((lint) => ["-W", `clippy::${lint}`]);
  const run = spawnSync(
    "cargo",
    ["clippy", "--workspace", ...targets, "--message-format=json", "--", ...warnings],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] },
  );
  if (run.error) throw run.error;

  const messages = run.stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line))
    .filter((record) => record.reason === "compiler-message");
  return { status: run.status, messages };
}

/** Maps cargo's package ids to package names. */
function packageNames() {
  const run = spawnSync("cargo", ["metadata", "--no-deps", "--format-version=1"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`cargo metadata failed:\n${run.stderr}`);
  const { packages } = JSON.parse(run.stdout);
  return new Map(packages.map((pkg) => [pkg.id, pkg.name]));
}

/** The lint a message reports, without the `clippy::` prefix, or null. */
function lintOf(record) {
  const code = record.message.code?.code ?? "";
  return code.startsWith("clippy::") ? code.slice("clippy::".length) : null;
}

/** One key per reported place, so code checked twice (lib and its tests) counts once. */
function hitKey(record) {
  const span = record.message.spans.find((candidate) => candidate.is_primary);
  const place = span ? `${span.file_name}:${span.line_start}:${span.column_start}` : "";
  return `${lintOf(record)}\t${record.package_id}\t${place}`;
}

/** Target kinds built as library or binary code, as opposed to tests, benches and examples. */
const SRC_KINDS = new Set([
  "lib",
  "rlib",
  "dylib",
  "cdylib",
  "staticlib",
  "proc-macro",
  "bin",
  "custom-build",
]);

/** Whether a target is checked once (no unit-test harness), so each of its hits is `src`. */
function checkedOnce(target) {
  return !target.test || target.kind.includes("custom-build");
}

/**
 * Counts hits of the ratcheted lints by lint, crate and scope.
 *
 * @param {object[]} messages `compiler-message` records from the `--all-targets` run
 * @param {Set<string>} lints the ratcheted lints
 * @param {Map<string, string>} names package id to package name
 * @returns {Record<string, Record<string, {src: number, tests: number}>>}
 */
export function countHits(messages, lints, names) {
  const reports = new Map();
  for (const record of messages.filter((candidate) => lints.has(lintOf(candidate) ?? ""))) {
    const key = hitKey(record);
    const seen = reports.get(key) ?? { record, times: 0 };
    seen.times += 1;
    reports.set(key, seen);
  }

  const counts = {};
  for (const { record, times } of reports.values()) {
    const { target } = record;
    const isSrc =
      target.kind.some((kind) => SRC_KINDS.has(kind)) && (checkedOnce(target) || times > 1);
    const lint = lintOf(record);
    const crate = names.get(record.package_id) ?? record.package_id;
    counts[lint] ??= {};
    counts[lint][crate] ??= { src: 0, tests: 0 };
    counts[lint][crate][isSrc ? "src" : "tests"] += 1;
  }
  return counts;
}

/**
 * Compares counts with the baseline.
 *
 * @returns {{ rose: string[], fell: string[], cleared: string[] }} one line per
 *   lint, crate and scope whose count rose or fell, and the lints with no hits left
 */
export function compare(baseline, counts) {
  const rose = [];
  const fell = [];
  const cleared = [];
  for (const lint of Object.keys(baseline).sort()) {
    const was = baseline[lint];
    const now = counts[lint] ?? {};
    const crates = [...new Set([...Object.keys(was), ...Object.keys(now)])].sort();
    let total = 0;
    for (const crate of crates) {
      for (const scope of ["src", "tests"]) {
        const before = was[crate]?.[scope] ?? 0;
        const after = now[crate]?.[scope] ?? 0;
        total += after;
        const line = `clippy::${lint} in ${crate} (${scope}): ${before} -> ${after}`;
        if (after > before) rose.push(line);
        if (after < before) fell.push(line);
      }
    }
    if (total === 0) cleared.push(lint);
  }
  return { rose, fell, cleared };
}

/** The baseline to write: every listed lint, and its crates with hits, sorted. */
export function baselineOf(lints, counts) {
  const baseline = {};
  for (const lint of [...lints].sort()) {
    baseline[lint] = {};
    for (const crate of Object.keys(counts[lint] ?? {}).sort()) {
      const { src, tests } = counts[lint][crate];
      baseline[lint][crate] = { src, tests };
    }
  }
  return baseline;
}

/** The baseline's file text: one line per crate, so a lowered count is a one-line diff. */
export function formatBaseline(baseline) {
  const lints = Object.entries(baseline).map(([lint, crates]) => {
    const lines = Object.entries(crates).map(
      ([crate, { src, tests }]) =>
        `    ${JSON.stringify(crate)}: { "src": ${src}, "tests": ${tests} }`,
    );
    const body = lines.length > 0 ? `{\n${lines.join(",\n")}\n  }` : "{}";
    return `  ${JSON.stringify(lint)}: ${body}`;
  });
  return `{\n${lints.join(",\n")}\n}\n`;
}

/** Messages that `-D warnings` would turn into a failure. */
export function failures(messages, lints) {
  const failing = messages.filter((record) => {
    const { level } = record.message;
    if (level === "error") return true;
    return level === "warning" && !lints.has(lintOf(record) ?? "");
  });
  const rendered = new Set(failing.map((record) => record.message.rendered));
  return [...rendered];
}

function main() {
  const update = process.argv.includes("--update");
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const lintList = Object.keys(baseline);
  const lints = new Set(lintList);

  const all = clippy(["--all-targets"], lintList);
  const broken = failures(all.messages, lints);
  if (broken.length > 0 || all.status !== 0) {
    for (const text of broken) process.stderr.write(text);
    console.error(`clippy failed: ${broken.length} warning(s) or error(s) outside the ratchet`);
    process.exit(1);
  }

  const counts = countHits(all.messages, lints, packageNames());
  const { rose, fell, cleared } = compare(baseline, counts);

  if (update) {
    writeFileSync(BASELINE, formatBaseline(baselineOf(lintList, counts)));
    for (const line of [...rose, ...fell]) console.log(line);
    console.log(`Updated ${BASELINE}`);
  } else {
    for (const line of rose) console.error(`rose: ${line}`);
    for (const line of fell) console.error(`fell: ${line}`);
  }

  for (const lint of cleared) {
    console.log(
      `clippy::${lint} has no hits left: move it to [workspace.lints.clippy] in Cargo.toml and delete it from clippy-ratchet.json`,
    );
  }
  if (update) return;

  if (rose.length > 0) {
    console.error("New hits of a ratcheted lint. Fix them; the baseline never goes up.");
    process.exit(1);
  }
  if (fell.length > 0) {
    console.error(`Fewer hits than the baseline. Lower it: ${UPDATE_COMMAND}`);
    process.exit(1);
  }
  console.log(`clippy clean; ${lintList.length} ratcheted lints at their baseline`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
