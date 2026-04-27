import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * Absolute paths to test fixtures, anchored to this module's own location so
 * tests work regardless of `process.cwd()` (vitest invokes from the package
 * directory; turbo invokes from the repo root; both must work).
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

// HERE = .../apps/desktop/src/renderer/src/testing/
// Six segments up to repo root.
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..", "..", "..");

export const FIXTURES_ROOT = resolve(REPO_ROOT, "fixtures");

export const MUTATORSANS_DESIGNSPACE = resolve(
  FIXTURES_ROOT,
  "fonts/mutatorsans-variable/MutatorSans.designspace",
);
