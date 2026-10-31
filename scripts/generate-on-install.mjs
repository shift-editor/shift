// Runs from `prepare` so a fresh install has the generated TypeScript an
// editor needs: the bridge types (crates/shift-bridge/index.d.ts and
// packages/types/src/bridge/generated.ts), which are not committed. Turbo
// generates them again before every typecheck, test and build, so CI skips
// this, and so does an install without Cargo.
import { execFileSync } from "node:child_process";
import process from "node:process";

const hasCargo = () => {
  try {
    execFileSync("cargo", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

if (process.env.CI) {
  console.log("Skipping generated types on install in CI; turbo tasks generate them.");
} else if (!hasCargo()) {
  console.log(
    "Skipping generated types on install: no cargo. Run `pnpm generate:bridge-types` in the dev shell.",
  );
} else {
  execFileSync("pnpm", ["generate:bridge-types"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}
