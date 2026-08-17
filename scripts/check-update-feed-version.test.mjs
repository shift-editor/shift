import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const script = path.resolve("scripts/check-update-feed-version.sh");

async function run(command, args, cwd) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

async function git(cwd, ...args) {
  const result = await run("git", args, cwd);
  assert.equal(result.code, 0, result.stderr);
}

async function createRemote(root) {
  const remote = path.join(root, "origin.git");
  const publisher = path.join(root, "publisher");
  const work = path.join(root, "work");
  await mkdir(publisher);
  await mkdir(work);
  await git(root, "init", "--bare", remote);
  await git(publisher, "init");
  await git(publisher, "config", "user.name", "Test");
  await git(publisher, "config", "user.email", "test@example.com");

  const feedPath = path.join(publisher, "updates/nightly/darwin/arm64/RELEASES.json");
  await mkdir(path.dirname(feedPath), { recursive: true });
  await writeFile(feedPath, JSON.stringify({ name: "0.1.0-nightly20260816r0000000043a0001" }));
  await git(publisher, "add", ".");
  await git(publisher, "commit", "-m", "feed");
  await git(publisher, "branch", "-M", "update-feeds");
  await git(publisher, "remote", "add", "origin", remote);
  await git(publisher, "push", "-u", "origin", "update-feeds");
  await git(work, "init");
  await git(work, "remote", "add", "origin", remote);

  return work;
}

test("fails closed when the update-feed remote cannot be inspected", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-update-preflight-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await git(root, "init");
  await git(root, "remote", "add", "origin", path.join(root, "missing.git"));

  const result = await run(script, ["nightly", "0.1.0-nightly20260816r0000000044a0001"], root);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Could not inspect the remote update-feeds branch/);
});

test("rejects Nightly public mutation before a native feed rollback", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-update-preflight-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const work = await createRemote(root);

  const result = await run(script, ["nightly", "0.1.0-nightly20260816r0000000042a0001"], work);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /must advance from 0.1.0-nightly20260816r0000000043a0001/);
});
