// Builds crates/shift-wasm into src/generated: the wasm-bindgen glue and the
// module embedded as base64, so every consumer loads it synchronously with no
// bundler plugin. It also builds the test-only `reference` feature into
// src/generated-reference, which `@shift/wasm/reference` loads for tests that
// compare the editor's TypeScript rules against shift-font. Neither output is
// committed: rustc's output depends on the build host, so both are built like
// the native addon, by turbo, before anything that imports them. Needs the Nix
// dev shell's wasm-bindgen (CI: .github/actions/wasm-toolchain), which must
// match the crate version in Cargo.lock exactly; wasm-opt comes from the
// pinned binaryen devDependency.
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const src = resolve(import.meta.dirname, "../src");
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
 * Each build: its folder under src and the crate features it enables. Largest
 * module first, so its wasm-opt pass overlaps the other variants' compiles.
 */
const variants = [
  { folder: "generated-shaping", features: ["shaping"] },
  { folder: "generated-reference", features: ["reference"] },
  { folder: "generated", features: [] },
];

// Compiles run in turn: they share one target directory, so later variants
// reuse the crates the first one compiled. Each variant's optimisation then
// runs while the next one compiles.
const finishing = [];
for (const variant of variants) {
  const out = join(src, variant.folder);
  await compile(out, variant.features);
  finishing.push(finish(out));
}
await Promise.all(finishing);

/** Compiles shift-wasm with `features` and writes the wasm-bindgen output to `out`. */
async function compile(out, features) {
  rmSync(out, { recursive: true, force: true });
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
      "--release",
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
    out,
    "target/wasm32-unknown-unknown/release/shift_wasm.wasm",
  ]);
}

/** Optimises the module in `out` and embeds it as base64. */
async function finish(out) {
  const wasm = join(out, "shift_wasm_bg.wasm");
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

  // The module is embedded below; the glue's fetch-by-URL fallback would make
  // bundlers emit an unused copy of it.
  const glue = join(out, "shift_wasm.js");
  const fallback =
    /\r?\n\s*module_or_path = new URL\('shift_wasm_bg\.wasm', import\.meta\.url\);(\r?\n)/;
  const source = readFileSync(glue, "utf8");
  if (!fallback.test(source)) {
    throw new Error(
      "wasm-bindgen glue no longer has the fetch-by-URL fallback this script removes",
    );
  }
  writeFileSync(glue, source.replace(fallback, "$1"));
  writeFileSync(
    join(out, "module.ts"),
    `// Generated by packages/wasm/scripts/build.mjs from crates/shift-wasm; do not edit.\n` +
      `export const moduleBase64 = "${readFileSync(wasm).toString("base64")}";\n`,
  );
  rmSync(wasm);
  rmSync(join(out, "shift_wasm_bg.wasm.d.ts"), { force: true });
  rmSync(join(out, ".gitignore"), { force: true });
}
