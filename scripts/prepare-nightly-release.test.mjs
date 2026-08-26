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
  [`desktop-nightly-linux-x64/Shift-Nightly-${version}-Linux-x64.AppImage`, "linux-appimage"],
];
const publicOutputs = new Map([
  ["Shift-Nightly-macOS-arm64.zip", "mac-arm64"],
  ["Shift-Nightly-macOS-x64.zip", "mac-x64"],
  ["Shift-Nightly-macOS-arm64.dmg", "dmg-arm64"],
  ["Shift-Nightly-macOS-x64.dmg", "dmg-x64"],
  ["Shift-Nightly-Windows-x64-Setup.exe", "windows"],
  ["Shift-Nightly-Linux-x64.deb", "linux-deb"],
  ["Shift-Nightly-Linux-x64.rpm", "linux-rpm"],
  ["Shift-Nightly-Linux-x64.AppImage", "linux-appimage"],
]);
const updateOutputs = new Map([
  [`Shift-Nightly-${version}-macOS-arm64.zip`, "mac-arm64"],
  [`Shift-Nightly-${version}-macOS-x64.zip`, "mac-x64"],
  [`Shift-Nightly-${version}-macOS-arm64.zip.blockmap`, "mac-arm64-blockmap"],
  [`Shift-Nightly-${version}-macOS-x64.zip.blockmap`, "mac-x64-blockmap"],
  [`Shift-Nightly-${version}-Windows-x64-Setup.exe`, "windows"],
  [`Shift-Nightly-${version}-Windows-x64-Setup.exe.blockmap`, "blockmap"],
]);

async function runScript(dist, publicOutput, updatesOutput, candidateVersion = version) {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [
      script,
      dist,
      publicOutput,
      updatesOutput,
      candidateVersion,
    ]);
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

async function runFixture(context, entries = fixtures, candidateVersion = version) {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-nightly-release-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dist = path.join(root, "dist");
  const publicOutput = path.join(root, "public");
  const updatesOutput = path.join(root, "updates");
  await writeFixtures(dist, entries);
  const result = await runScript(dist, publicOutput, updatesOutput, candidateVersion);
  return { root, dist, publicOutput, updatesOutput, result };
}

test("prepares friendly public aliases and exact versioned updater assets", async (context) => {
  const { publicOutput, updatesOutput, result } = await runFixture(context);
  assert.equal(result.code, 0, result.stderr);

  for (const [destination, content] of publicOutputs) {
    assert.equal(await readFile(path.join(publicOutput, destination), "utf8"), content);
  }
  for (const [destination, content] of updateOutputs) {
    assert.equal(await readFile(path.join(updatesOutput, destination), "utf8"), content);
  }

  const checksumLines = (await readFile(path.join(publicOutput, "SHA256SUMS"), "utf8"))
    .trim()
    .split("\n");
  assert.deepEqual(
    checksumLines,
    [...publicOutputs]
      .map(([destination, content]) => {
        const digest = createHash("sha256").update(content).digest("hex");
        return `${digest}  ${destination}`;
      })
      .sort(),
  );
});

test("rejects incomplete Nightly artifact sets", async (context) => {
  const { result } = await runFixture(context, fixtures.slice(1));
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Expected one source.*found 0/);
});

test("rejects ambiguous Nightly artifacts", async (context) => {
  const fixture = await runFixture(context);
  await writeFixtures(fixture.dist, [
    [`duplicate/Shift-Nightly-${version}-macOS-arm64.zip`, "duplicate"],
  ]);

  const result = await runScript(
    fixture.dist,
    path.join(fixture.root, "second-public"),
    path.join(fixture.root, "second-updates"),
  );
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Expected one source.*found 2/);
});

test("rejects artifacts from a different Nightly version", async (context) => {
  const { result } = await runFixture(context, fixtures, "0.322.1");
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Expected one source.*found 0/);
});
