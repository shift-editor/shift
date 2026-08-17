import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const script = path.resolve("scripts/prepare-update-feed.mjs");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const signingEnvironment = {
  SHIFT_UPDATE_PRIVATE_KEY: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  SHIFT_UPDATE_PUBLIC_KEY: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
};

async function writeArtifacts(root, complete = true) {
  const fixtures = [
    ["zip/darwin/arm64/Shift-darwin-arm64-0.1.0-alpha.2.zip", "mac-arm64"],
    ["zip/darwin/x64/Shift-darwin-x64-0.1.0-alpha.2.zip", "mac-x64"],
    ["squirrel.windows/x64/shift-0.1.0-alpha.2-full.nupkg", "windows-x64"],
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
    const child = spawn(process.execPath, args, {
      env: { ...process.env, ...signingEnvironment },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

test("publishes signed channel metadata and native updater feeds", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-update-feed-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const artifacts = path.join(root, "artifacts");
  const site = path.join(root, "site");
  await writeArtifacts(artifacts);

  const result = await runScript(artifacts, site);
  assert.equal(result.code, 0, result.stderr);

  const envelope = JSON.parse(
    await readFile(path.join(site, "updates/release/channel.json"), "utf8"),
  );
  const payload = Buffer.from(envelope.payload, "base64");
  assert.equal(verify(null, payload, publicKey, Buffer.from(envelope.signature, "base64")), true);

  const descriptor = JSON.parse(payload.toString("utf8"));
  assert.equal(descriptor.version, "0.1.0-alpha.2");
  assert.deepEqual(
    descriptor.artifacts.map((artifact) => `${artifact.platform}-${artifact.architecture}`),
    ["darwin-arm64", "darwin-x64", "win32-x64"],
  );

  const macFeed = JSON.parse(
    await readFile(path.join(site, "updates/release/0.1.0-alpha.2/darwin/arm64/RELEASES.json")),
  );
  assert.equal(macFeed.sha256, descriptor.artifacts[0].sha256);
  assert.equal(macFeed.size, 9);

  const releases = await readFile(
    path.join(site, "updates/release/0.1.0-alpha.2/win32/x64/RELEASES"),
    "utf8",
  );
  assert.match(releases, /shift-0\.1\.0-alpha\.2-full\.nupkg 11\n$/);
});

test("rejects an existing immutable update version", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-update-feed-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const artifacts = path.join(root, "artifacts");
  const site = path.join(root, "site");
  await writeArtifacts(artifacts);
  assert.equal((await runScript(artifacts, site)).code, 0);
  const channel = await readFile(path.join(site, "updates/release/channel.json"), "utf8");

  const duplicate = await runScript(artifacts, site);
  assert.notEqual(duplicate.code, 0);
  assert.match(duplicate.stderr, /Update feed version already exists: release 0.1.0-alpha.2/);
  assert.equal(await readFile(path.join(site, "updates/release/channel.json"), "utf8"), channel);
});

test("an incomplete artifact set cannot advance the channel pointer", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-update-feed-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const complete = path.join(root, "complete");
  const incomplete = path.join(root, "incomplete");
  const site = path.join(root, "site");
  await writeArtifacts(complete);
  await writeArtifacts(incomplete, false);
  assert.equal((await runScript(complete, site)).code, 0);
  const channel = await readFile(path.join(site, "updates/release/channel.json"), "utf8");

  const failed = await runScript(incomplete, site, "0.1.0-alpha.3");
  assert.notEqual(failed.code, 0);
  assert.match(failed.stderr, /Expected one macOS arm64 ZIP, found 0/);
  assert.equal(await readFile(path.join(site, "updates/release/channel.json"), "utf8"), channel);
});
