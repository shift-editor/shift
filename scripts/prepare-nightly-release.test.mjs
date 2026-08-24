import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const script = path.resolve("scripts/prepare-nightly-release.mjs");
const version = "0.321.2";
const fixtures = [
  [`desktop-nightly-darwin-arm64/Shift-Nightly-${version}-macOS-arm64.zip`, "mac-arm64"],
  [`desktop-nightly-darwin-x64/Shift-Nightly-${version}-macOS-x64.zip`, "mac-x64"],
  [
    `desktop-nightly-darwin-arm64/Shift-Nightly-${version}-macOS-arm64.zip.blockmap`,
    "mac-arm64-blockmap",
  ],
  [
    `desktop-nightly-darwin-x64/Shift-Nightly-${version}-macOS-x64.zip.blockmap`,
    "mac-x64-blockmap",
  ],
  [`desktop-nightly-darwin-arm64/Shift-Nightly-${version}-macOS-arm64.dmg`, "dmg-arm64"],
  [`desktop-nightly-darwin-x64/Shift-Nightly-${version}-macOS-x64.dmg`, "dmg-x64"],
  [`desktop-nightly-win32-x64/Shift-Nightly-${version}-Windows-x64-Setup.exe`, "windows"],
  [`desktop-nightly-win32-x64/Shift-Nightly-${version}-Windows-x64-Setup.exe.blockmap`, "blockmap"],
  [`desktop-nightly-linux-x64/Shift-Nightly-${version}-Linux-x64.deb`, "linux-deb"],
  [`desktop-nightly-linux-x64/Shift-Nightly-${version}-Linux-x64.rpm`, "linux-rpm"],
];
const outputs = new Map([
  [`Shift-Nightly-${version}-macOS-arm64.zip`, "mac-arm64"],
  [`Shift-Nightly-${version}-macOS-x64.zip`, "mac-x64"],
  [`Shift-Nightly-${version}-macOS-arm64.zip.blockmap`, "mac-arm64-blockmap"],
  [`Shift-Nightly-${version}-macOS-x64.zip.blockmap`, "mac-x64-blockmap"],
  [`Shift-Nightly-${version}-macOS-arm64.dmg`, "dmg-arm64"],
  [`Shift-Nightly-${version}-macOS-x64.dmg`, "dmg-x64"],
  [`Shift-Nightly-${version}-Windows-x64-Setup.exe`, "windows"],
  [`Shift-Nightly-${version}-Windows-x64-Setup.exe.blockmap`, "blockmap"],
  [`Shift-Nightly-${version}-Linux-x64.deb`, "linux-deb"],
  [`Shift-Nightly-${version}-Linux-x64.rpm`, "linux-rpm"],
]);

async function runScript(dist, output, candidateVersion = version) {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [script, dist, output, candidateVersion]);
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

async function writeFixtures(root, entries = fixtures) {
  for (const [relativePath, content] of entries) {
    const file = path.join(root, relativePath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
}

test("prepares one exact versioned Nightly asset set", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-nightly-release-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dist = path.join(root, "dist");
  const output = path.join(root, "public");
  await writeFixtures(dist);

  const result = await runScript(dist, output);
  assert.equal(result.code, 0, result.stderr);
  for (const [destination, content] of outputs) {
    assert.equal(await readFile(path.join(output, destination), "utf8"), content);
  }

  const checksumLines = (await readFile(path.join(output, "SHA256SUMS"), "utf8"))
    .trim()
    .split("\n");
  assert.deepEqual(
    checksumLines,
    [...outputs]
      .map(([destination, content]) => {
        const digest = createHash("sha256").update(content).digest("hex");
        return `${digest}  ${destination}`;
      })
      .sort(),
  );
});

test("rejects incomplete Nightly artifact sets", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-nightly-release-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dist = path.join(root, "dist");
  await writeFixtures(dist, fixtures.slice(1));

  const result = await runScript(dist, path.join(root, "public"));
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Expected one source.*found 0/);
});

test("rejects ambiguous Nightly artifacts", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-nightly-release-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dist = path.join(root, "dist");
  await writeFixtures(dist);
  await writeFixtures(dist, [[`duplicate/Shift-Nightly-${version}-macOS-arm64.zip`, "duplicate"]]);

  const result = await runScript(dist, path.join(root, "public"));
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Expected one source.*found 2/);
});

test("rejects artifacts from a different Nightly version", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-nightly-release-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dist = path.join(root, "dist");
  await writeFixtures(dist);

  const result = await runScript(dist, path.join(root, "public"), "0.322.1");
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Expected one source.*found 0/);
});
