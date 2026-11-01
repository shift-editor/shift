// Builds the addon with `napi build`, which also writes index.d.ts, and writes
// protocol.ts from the same compile when it can, so a CI job that builds the
// addon compiles the bridge once instead of again for types.mjs's check.
//
// The pack macros write their fragments only for a crate they expand, and
// Cargo doesn't rebuild a crate that is up to date because PACK_TS_DIR is set.
// CI never caches the workspace crates, so its builds expand every one; a
// local rebuild usually expands only some, and then protocol.ts is left to
// `pnpm generate:bridge-types`. The fragments go to a folder of this build's
// own, so another checkout sharing target/ can't mix its fragments in.
// protocol.ts is not a turbo output of the build: a replayed build would put
// back one older than the one types.mjs wrote.
//
// Usage: node scripts/build.mjs <release|debug|e2e>. SHIFT_RUST_TARGET, when
// set, is the target triple to build for, such as x86_64-apple-darwin.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { NapiCli } from "@napi-rs/cli";
import { missingFragments, writeProtocol } from "./protocol.mjs";

const crate = resolve(import.meta.dirname, "..");
const root = resolve(crate, "../..");

/** napi build's options for each profile this script builds. */
const profiles = {
  release: { release: true },
  debug: {},
  e2e: { profile: "e2e" },
};

const profile = process.argv[2];
const profileOptions = profiles[profile];
if (!profileOptions) {
  throw new Error(`Usage: build.mjs <${Object.keys(profiles).join("|")}>, not ${profile}`);
}
const target = process.env.SHIFT_RUST_TARGET || undefined;

const fragmentRoot = join(root, "target", "napi-rs");
mkdirSync(fragmentRoot, { recursive: true });
const fragments = mkdtempSync(join(fragmentRoot, "pack-fragments-"));
process.env.PACK_TS_DIR = fragments;
try {
  const { task } = await new NapiCli().build({
    cwd: crate,
    platform: true,
    target,
    ...profileOptions,
  });
  await task;

  const missing = missingFragments(fragments);
  if (missing.length === 0) {
    writeProtocol(fragments);
  } else {
    console.log(
      `protocol.ts not written: ${missing.join(", ")} did not rebuild; \`pnpm generate:bridge-types\` writes it.`,
    );
  }
} finally {
  rmSync(fragments, { recursive: true, force: true });
}
