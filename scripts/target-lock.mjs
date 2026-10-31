// A lock across processes for a script step that reads what an earlier cargo
// run wrote under target/: Cargo's own lock covers one cargo run, not the gap
// between a `cargo check` and the generator reading its fragments, or between
// `cargo build` and wasm-bindgen reading the module. Checkouts that share one
// target directory would otherwise read each other's output.
//
// proper-lockfile keeps the lock fresh on a timer and treats one left
// unrefreshed for 10 s as abandoned, so a step must not block the event loop
// while it holds the lock: run cargo through `cargo` below, not execFileSync.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import lockfile from "proper-lockfile";

/** Runs `step` while holding the lock named `name` under `targetDir`, waiting for any other holder. */
export async function withLock(targetDir, name, step) {
  const locks = join(targetDir, ".locks");
  mkdirSync(locks, { recursive: true });
  // proper-lockfile tracks its locks by the path locked, so each name locks its
  // own path (which need not exist); the lock itself is `<path>.lock`.
  const release = await lockfile.lock(join(locks, name), {
    realpath: false,
    retries: { forever: true, minTimeout: 100, maxTimeout: 500 },
  });
  try {
    return await step();
  } finally {
    await release();
  }
}

/** Runs cargo with `args` from `cwd`, printing its output, without blocking the event loop. */
export function cargo(args, { cwd, env = process.env }) {
  return new Promise((resolve, reject) => {
    const child = spawn("cargo", args, { cwd, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`cargo ${args[0]} exited with ${code}`)),
    );
  });
}
