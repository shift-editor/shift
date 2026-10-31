import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withLock } from "./target-lock.mjs";

const lockModule = fileURLToPath(new URL("./target-lock.mjs", import.meta.url));

function tempTarget(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "target-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Starts a process that holds `name` under `target` until it is killed; resolves once it holds it. */
function holder(t, target, name) {
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { withLock } from ${JSON.stringify(lockModule)};
       await withLock(${JSON.stringify(target)}, ${JSON.stringify(name)}, () => {
         console.log("held");
         // A pending promise alone does not keep the process alive.
         return new Promise(() => setInterval(() => {}, 1000));
       });`,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  t.after(() => child.kill());
  return new Promise((resolve) => child.stdout.once("data", () => resolve(child)));
}

test("withLock waits while another process holds the lock", async (t) => {
  const target = tempTarget(t);
  const child = await holder(t, target, "step");
  let ran = false;
  const step = withLock(target, "step", () => {
    ran = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(ran, false);
  child.kill();
  // proper-lockfile releases a lock when its process exits on a signal.
  await step;
  assert.equal(ran, true);
});

test("withLock releases the lock when the step throws", async (t) => {
  const target = tempTarget(t);
  await assert.rejects(
    withLock(target, "step", () => {
      throw new Error("step failed");
    }),
    /step failed/,
  );
  let ran = false;
  await withLock(target, "step", () => {
    ran = true;
  });
  assert.equal(ran, true);
});
