import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const script = path.resolve("scripts/prepare-nightly-release.mjs");
const fixtures = [
  ["zip/darwin/arm64/Shift Nightly-darwin-arm64-version.zip", "mac-arm64"],
  ["zip/darwin/x64/Shift Nightly-darwin-x64-version.zip", "mac-x64"],
  ["squirrel.windows/x64/Shift Nightly-version-Setup.exe", "windows-x64"],
  ["deb/x64/shift-nightly_version_amd64.deb", "linux-deb"],
  ["rpm/x64/shift-nightly-version.x86_64.rpm", "linux-rpm"],
];
const destinations = [
  "Shift-Nightly-macOS-arm64.zip",
  "Shift-Nightly-macOS-x64.zip",
  "Shift-Nightly-Windows-x64.exe",
  "Shift-Nightly-Linux-x64.deb",
  "Shift-Nightly-Linux-x64.rpm",
];

async function runScript(dist, output) {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [script, dist, output]);
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

test("prepares stable-name Nightly assets and checksums", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-nightly-release-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dist = path.join(root, "dist");
  const output = path.join(root, "public");
  await writeFixtures(dist);

  const result = await runScript(dist, output);
  assert.equal(result.code, 0, result.stderr);

  for (const [index, destination] of destinations.entries()) {
    const content = await readFile(path.join(output, destination), "utf8");
    assert.equal(content, fixtures[index][1]);
  }

  const checksumLines = (await readFile(path.join(output, "SHA256SUMS"), "utf8"))
    .trim()
    .split("\n");
  assert.deepEqual(
    checksumLines,
    destinations.map((destination, index) => {
      const digest = createHash("sha256").update(fixtures[index][1]).digest("hex");
      return `${digest}  ${destination}`;
    }),
  );
});

test("rejects incomplete Nightly artifact sets", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-nightly-release-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dist = path.join(root, "dist");
  await writeFixtures(dist, fixtures.slice(1));

  const result = await runScript(dist, path.join(root, "public"));
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Expected one source for Shift-Nightly-macOS-arm64\.zip, found 0/);
});

test("rejects ambiguous Nightly artifacts", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-nightly-release-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dist = path.join(root, "dist");
  await writeFixtures(dist);
  await writeFixtures(dist, [["duplicate/zip/darwin/arm64/other.zip", "duplicate"]]);

  const result = await runScript(dist, path.join(root, "public"));
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Expected one source for Shift-Nightly-macOS-arm64\.zip, found 2/);
});
