import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { squirrelPackageVersion } from "./update-versions.mjs";

const script = path.resolve("scripts/prepare-update-feed.mjs");

async function writeArtifacts(root, { version = "0.1.0-alpha.2", complete = true } = {}) {
  const nupkgVersion = squirrelPackageVersion(version);
  const fixtures = [
    [`zip/darwin/arm64/Shift-darwin-arm64-${version}.zip`, "mac-arm64"],
    [`zip/darwin/x64/Shift-darwin-x64-${version}.zip`, "mac-x64"],
    [`squirrel.windows/x64/shift-${nupkgVersion}-full.nupkg`, "windows-x64"],
  ];
  for (const [relative, content] of complete ? fixtures : fixtures.slice(1)) {
    const destination = path.join(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
}

async function runScript(artifacts, site, version = "0.1.0-alpha.2") {
  const args = [
    script,
    artifacts,
    site,
    "release",
    version,
    `v${version}`,
    "2026-08-16T12:00:00.000Z",
  ];
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, args);
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

test("publishes immutable and current native updater feeds", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-update-feed-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const artifacts = path.join(root, "artifacts");
  const site = path.join(root, "site");
  await writeArtifacts(artifacts);

  const result = await runScript(artifacts, site);
  assert.equal(result.code, 0, result.stderr);

  const immutableMac = await readFile(
    path.join(site, "updates/release/0.1.0-alpha.2/darwin/arm64/RELEASES.json"),
    "utf8",
  );
  const currentMac = await readFile(
    path.join(site, "updates/release/darwin/arm64/RELEASES.json"),
    "utf8",
  );
  assert.equal(currentMac, immutableMac);
  const macFeed = JSON.parse(currentMac);
  assert.equal(macFeed.name, "0.1.0-alpha.2");
  assert.equal(macFeed.size, 9);

  const immutableWindows = await readFile(
    path.join(site, "updates/release/0.1.0-alpha.2/win32/x64/RELEASES"),
    "utf8",
  );
  const currentWindows = await readFile(
    path.join(site, "updates/release/win32/x64/RELEASES"),
    "utf8",
  );
  assert.equal(currentWindows, immutableWindows);
  assert.match(currentWindows, /shift-0\.1\.0-alpha2-full\.nupkg 11\n$/);
});

test("preserves Nightly ordering in electron-winstaller's NuGet version", () => {
  assert.equal(squirrelPackageVersion("0.1.0-alpha.2"), "0.1.0-alpha2");
  const older = squirrelPackageVersion("0.1.0-nightly20260816r0000000009a0001");
  const newerRun = squirrelPackageVersion("0.1.0-nightly20260816r0000000010a0001");
  const newerAttempt = squirrelPackageVersion("0.1.0-nightly20260816r0000000010a0002");
  assert.equal(older < newerRun, true);
  assert.equal(newerRun < newerAttempt, true);
});

test("rejects an existing immutable update version", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-update-feed-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const artifacts = path.join(root, "artifacts");
  const site = path.join(root, "site");
  await writeArtifacts(artifacts);
  assert.equal((await runScript(artifacts, site)).code, 0);
  const current = await readFile(
    path.join(site, "updates/release/darwin/arm64/RELEASES.json"),
    "utf8",
  );

  const duplicate = await runScript(artifacts, site);
  assert.notEqual(duplicate.code, 0);
  assert.match(duplicate.stderr, /Update feed version already exists: release 0.1.0-alpha.2/);
  assert.equal(
    await readFile(path.join(site, "updates/release/darwin/arm64/RELEASES.json"), "utf8"),
    current,
  );
});

test("rejects a native feed pointer that moves backward", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-update-feed-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const newer = path.join(root, "newer");
  const older = path.join(root, "older");
  const site = path.join(root, "site");
  await writeArtifacts(newer, { version: "0.1.0-alpha.3" });
  await writeArtifacts(older, { version: "0.1.0-alpha.2" });
  assert.equal((await runScript(newer, site, "0.1.0-alpha.3")).code, 0);
  const current = await readFile(
    path.join(site, "updates/release/darwin/arm64/RELEASES.json"),
    "utf8",
  );

  const downgrade = await runScript(older, site, "0.1.0-alpha.2");
  assert.notEqual(downgrade.code, 0);
  assert.match(downgrade.stderr, /must advance from 0.1.0-alpha.3.*0.1.0-alpha.2/);
  assert.equal(
    await readFile(path.join(site, "updates/release/darwin/arm64/RELEASES.json"), "utf8"),
    current,
  );
});

test("an incomplete artifact set cannot advance native feeds", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-update-feed-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const complete = path.join(root, "complete");
  const incomplete = path.join(root, "incomplete");
  const site = path.join(root, "site");
  await writeArtifacts(complete);
  await writeArtifacts(incomplete, { version: "0.1.0-alpha.3", complete: false });
  assert.equal((await runScript(complete, site)).code, 0);
  const current = await readFile(
    path.join(site, "updates/release/darwin/arm64/RELEASES.json"),
    "utf8",
  );

  const failed = await runScript(incomplete, site, "0.1.0-alpha.3");
  assert.notEqual(failed.code, 0);
  assert.match(failed.stderr, /Expected one macOS arm64 ZIP, found 0/);
  assert.equal(
    await readFile(path.join(site, "updates/release/darwin/arm64/RELEASES.json"), "utf8"),
    current,
  );
});
