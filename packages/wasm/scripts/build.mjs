// Builds crates/shift-wasm into src/generated: the wasm-bindgen glue and the
// module embedded as base64, so every consumer loads it synchronously with no
// bundler plugin. The engine variant is the exception: it ships as its own
// shift_wasm_bg.wasm, which `@shift/wasm/engine` compiles on import, because
// parsing and decoding its 3.8 MB of base64 cost a window about 60 MB. It also builds the test-only `reference` feature into
// src/generated-reference, which `@shift/wasm/reference` loads for tests that
// compare the editor's TypeScript rules against shift-font. Neither output is
// committed: rustc's output depends on the build host, so both are built like
// the native addon, by turbo, before anything that imports them. Needs the Nix
// dev shell's wasm-bindgen (CI: .github/actions/wasm-toolchain), which must
// match the crate version in Cargo.lock exactly; wasm-opt comes from the
// pinned binaryen devDependency.
//
// A plain run builds the variants the app loads (`generated`,
// `generated-shaping`); `--reference` builds only the test-only reference
// variant. With `--types`, it writes every variant's declarations
// (shift_wasm.d.ts and module.d.ts) from a debug build, for typecheck. Release
// builds write the same declarations, so the two never disagree.
//
// wasm-opt only shrinks the module, so it runs only with SHIFT_WASM_OPT=1, which
// the Nightly, release and perf workflows set; everywhere else, including
// local builds and CI tests, skips its ~20 s.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const src = resolve(import.meta.dirname, "../src");
const typesOnly = process.argv.includes("--types");
const referenceOnly = process.argv.includes("--reference");
const optimise = process.env.SHIFT_WASM_OPT === "1";
const profile = typesOnly ? "debug" : "release";
const run = (command, args, env = process.env) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", env });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`)),
    );
  });
// binaryen's wasm-opt is a Node script, so it runs the same on every OS.
const binaryen = createRequire(import.meta.url).resolve("binaryen/package.json");
const wasmOpt = join(dirname(binaryen), JSON.parse(readFileSync(binaryen, "utf8")).bin["wasm-opt"]);

const locked = /name = "wasm-bindgen"\r?\nversion = "([^"]+)"/.exec(
  readFileSync(join(root, "Cargo.lock"), "utf8"),
)?.[1];
const cli = execFileSync("wasm-bindgen", ["--version"], { encoding: "utf8" }).trim().split(" ")[1];
if (locked !== cli) {
  throw new Error(`wasm-bindgen CLI ${cli} does not match ${locked} in Cargo.lock`);
}

/**
 * Each build: its folder under src, the crate features it enables, whether
 * only tests load it, and whether its module ships as a file beside the glue
 * rather than embedded. Largest module first, so its wasm-opt pass overlaps
 * the other variants' compiles.
 */
const allVariants = [
  { folder: "generated-engine", features: ["engine"], testOnly: false, file: true },
  { folder: "generated-shaping", features: ["shaping"], testOnly: false, file: false },
  { folder: "generated-reference", features: ["reference"], testOnly: true, file: false },
  { folder: "generated", features: [], testOnly: false, file: false },
];
const variants = typesOnly
  ? allVariants
  : allVariants.filter((variant) => variant.testOnly === referenceOnly);

// Compiles run in turn: they share one target directory, so later variants
// reuse the crates the first one compiled. Each variant's optimisation then
// runs while the next one compiles.
const finishing = [];
for (const variant of variants) {
  const staged = await compile(variant.folder, variant.features);
  const out = join(src, variant.folder);
  mkdirSync(out, { recursive: true });
  writeDeclarations(staged, out, variant.file);
  if (!typesOnly) finishing.push(finish(staged, out, variant.file));
}
await Promise.all(finishing);

/**
 * Compiles shift-wasm with `features` and writes the wasm-bindgen output to a
 * staging folder under target, so a build never leaves src half-written while
 * the other mode reads or writes it. Returns that folder.
 */
async function compile(folder, features) {
  const staged = join(root, "target", "wasm-bindgen", profile, folder);
  rmSync(staged, { recursive: true, force: true });
  // Paths of the Cargo home end up in panic messages; replace them so the
  // module carries no machine's paths. Cargo passes workspace crates as paths
  // relative to the checkout, so the checkout needs no remapping, and RUSTFLAGS
  // stays the same in every checkout (it is part of each crate's fingerprint).
  // RUSTFLAGS replaces the target flags in .cargo/config.toml, so they are
  // repeated here.
  const cargoHome = process.env.CARGO_HOME ?? join(homedir(), ".cargo");
  await run(
    "cargo",
    [
      "build",
      "-p",
      "shift-wasm",
      "--target",
      "wasm32-unknown-unknown",
      ...(typesOnly ? [] : ["--release"]),
      ...features.flatMap((feature) => ["--features", feature]),
    ],
    {
      ...process.env,
      RUSTFLAGS: [
        `--remap-path-prefix=${cargoHome}=/cargo`,
        "--cfg",
        'getrandom_backend="wasm_js"',
      ].join(" "),
    },
  );
  await run("wasm-bindgen", [
    "--target",
    "web",
    "--out-name",
    "shift_wasm",
    "--out-dir",
    staged,
    `target/wasm32-unknown-unknown/${profile}/shift_wasm.wasm`,
  ]);
  return staged;
}

/**
 * Writes the variant's declarations to `out`: the glue's, with `InitOutput`
 * sorted, because its members follow the module's export order, which differs
 * between debug and release builds; and module.d.ts, so typecheck needs no
 * embedded module.
 */
function writeDeclarations(staged, out, file) {
  const declarations = readFileSync(join(staged, "shift_wasm.d.ts"), "utf8");
  const initOutput = /(export interface InitOutput \{\r?\n)([\s\S]*?)(\r?\n\})/;
  const match = initOutput.exec(declarations);
  if (!match) throw new Error("wasm-bindgen declarations no longer have an InitOutput interface");
  const members = match[2].split(/\r?\n/).sort();
  install(
    join(out, "shift_wasm.d.ts"),
    declarations.replace(initOutput, `$1${members.join("\n")}$3`),
  );
  if (file) {
    // A variant that moved from embedded to file must not leave the old module behind.
    for (const stale of ["module.ts", "module.d.ts"]) rmSync(join(out, stale), { force: true });
    return;
  }
  install(
    join(out, "module.d.ts"),
    `// Generated by packages/wasm/scripts/build.mjs from crates/shift-wasm; do not edit.\n` +
      `export declare const moduleBase64: string;\n`,
  );
}

/**
 * Optimises the staged module when asked and installs the glue in `out`,
 * with the module as a file when `file` is set and embedded otherwise.
 */
async function finish(staged, out, file) {
  const wasm = join(staged, "shift_wasm_bg.wasm");
  if (optimise) await optimiseModule(wasm);

  // The module is embedded below; the glue's fetch-by-URL fallback would make
  // bundlers emit an unused copy of it.
  const fallback =
    /\r?\n\s*module_or_path = new URL\('shift_wasm_bg\.wasm', import\.meta\.url\);(\r?\n)/;
  const source = readFileSync(join(staged, "shift_wasm.js"), "utf8");
  if (!fallback.test(source)) {
    throw new Error(
      "wasm-bindgen glue no longer has the fetch-by-URL fallback this script removes",
    );
  }
  install(join(out, "shift_wasm.js"), source.replace(fallback, "$1"));
  if (file) {
    install(join(out, "shift_wasm_bg.wasm"), readFileSync(wasm));
    return;
  }
  install(
    join(out, "module.ts"),
    `// Generated by packages/wasm/scripts/build.mjs from crates/shift-wasm; do not edit.\n` +
      `export const moduleBase64 = "${readFileSync(wasm).toString("base64")}";\n`,
  );
}

/** Replaces `path` with `contents` in one rename, so a reader never sees it half-written. */
function install(path, contents) {
  const next = `${path}.next`;
  writeFileSync(next, contents);
  renameSync(next, path);
}

/** Shrinks `wasm` in place with wasm-opt. */
async function optimiseModule(wasm) {
  await run(process.execPath, [
    wasmOpt,
    "-Oz",
    ...[
      "bulk-memory",
      "multivalue",
      "mutable-globals",
      "nontrapping-float-to-int",
      "reference-types",
      "sign-ext",
    ].map((feature) => `--enable-${feature}`),
    wasm,
    "-o",
    wasm,
  ]);
}
