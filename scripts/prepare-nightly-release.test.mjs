import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const script = path.resolve("scripts/prepare-nightly-release.mjs");
const version = "0.1.0-nightly.20260816.42.2";
const nupkgVersion = "0.1.0-nightly20260816422";
const fixtures = [
  [`zip/darwin/arm64/Shift Nightly-darwin-arm64-${version}.zip`, "mac-arm64"],
  [`zip/darwin/x64/Shift Nightly-darwin-x64-${version}.zip`, "mac-x64"],
  [`squirrel.windows/x64/Shift Nightly-${version}-Setup.exe`, "windows-x64"],
  [`squirrel.windows/x64/shift_nightly-${nupkgVersion}-full.nupkg`, "windows-update"],
  [`deb/x64/shift-nightly_${version}_amd64.deb`, "linux-deb"],
  [`rpm/x64/shift-nightly-${version}.x86_64.rpm`, "linux-rpm"],
];
const outputs = new Map([
  ["Shift-Nightly-macOS-arm64.zip", "mac-arm64"],
  [`Shift-Nightly-${version}-macOS-arm64.zip`, "mac-arm64"],
  ["Shift-Nightly-macOS-x64.zip", "mac-x64"],
  [`Shift-Nightly-${version}-macOS-x64.zip`, "mac-x64"],
  ["Shift-Nightly-Windows-x64.exe", "windows-x64"],
  [`shift_nightly-${nupkgVersion}-full.nupkg`, "windows-update"],
  ["Shift-Nightly-Linux-x64.deb", "linux-deb"],
  ["Shift-Nightly-Linux-x64.rpm", "linux-rpm"],
]);

async function runScript(dist, output) {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [script, dist, output, version]);
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

test("prepares human downloads and versioned Nightly update assets", async (context) => {
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
  await writeFixtures(dist, [[`duplicate/zip/darwin/arm64/other-${version}.zip`, "duplicate"]]);

  const result = await runScript(dist, path.join(root, "public"));
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Expected one source.*found 2/);
});
