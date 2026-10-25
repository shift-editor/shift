// Writes index.d.ts without building the addon. napi-derive's macros write
// each crate's type definitions while they expand, which `cargo check` does in
// seconds; the release build behind `napi build` costs most of a minute. The
// output is the same index.d.ts `napi build` writes.
//
// The check uses its own target directory: napi-derive writes the definitions
// only when NAPI_TYPE_DEF_TMP_FOLDER is set, so a check without it in a shared
// directory would leave a crate up to date with no fresh definitions.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generateTypeDef } from "@napi-rs/cli";

const crate = resolve(import.meta.dirname, "..");
const root = resolve(crate, "../..");
const targetDir = join(root, "target", "napi-types");
const typeDefDir = join(targetDir, "type-defs");
/** Crates whose `#[napi]` items reach index.d.ts. */
const napiCrates = ["shift-bridge", "shift-wire"];

mkdirSync(typeDefDir, { recursive: true });
const cargo = (args) =>
  execFileSync("cargo", [...args, "--target-dir", targetDir], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NAPI_TYPE_DEF_TMP_FOLDER: typeDefDir },
  });
// A crate that is up to date but has no definitions file would contribute
// nothing; clean it so the check expands its macros again.
const missing = napiCrates.filter((name) => !existsSync(join(typeDefDir, name)));
if (missing.length > 0) cargo(["clean", ...missing.flatMap((name) => ["-p", name])]);
cargo(["check", "-p", "shift-bridge"]);

const { dts } = await generateTypeDef({
  typeDefDir,
  configDtsHeaderFile: "dts-header.d.ts",
  cwd: crate,
});
writeFileSync(join(crate, "index.d.ts"), dts);
