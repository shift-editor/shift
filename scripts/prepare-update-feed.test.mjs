import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dump, load } from "js-yaml";
import {
  compareProductVersions,
  prepareUpdateFeed,
  rewriteUpdateMetadata,
} from "./prepare-update-feed.mjs";

const repository = "shift-editor/shift";

async function writeArtifacts(root, { version = "0.1.1", distribution = "release" } = {}) {
  const prefix = distribution === "nightly" ? "Shift-Nightly" : "Shift";
  for (const architecture of ["arm64", "x64"]) {
    const assetName = `${prefix}-${version}-macOS-${architecture}.zip`;
    const directory = path.join(root, `desktop-${distribution}-darwin-${architecture}`);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, assetName), architecture);
    await writeFile(path.join(directory, `${assetName}.blockmap`), `${architecture}-blockmap`);
    await writeFile(
      path.join(directory, "latest-mac.yml"),
      dump({
        version,
        files: [{ url: assetName, sha512: `mac-${architecture}`, size: architecture.length }],
        path: assetName,
        sha512: `mac-${architecture}`,
        releaseDate: "2026-08-16T12:00:00.000Z",
      }),
    );
  }

  if (distribution === "nightly") {
    const assetName = `${prefix}-${version}-Windows-x64-Setup.exe`;
    const directory = path.join(root, `desktop-${distribution}-win32-x64`);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, assetName), "windows");
    await writeFile(path.join(directory, `${assetName}.blockmap`), "blockmap");
    await writeFile(
      path.join(directory, "latest.yml"),
      dump({
        version,
        files: [{ url: assetName, sha512: "windows", size: 7 }],
        path: assetName,
        sha512: "windows",
        releaseDate: "2026-08-16T12:00:00.000Z",
      }),
    );
  }
}

test("compares canonical product versions numerically", () => {
  assert.equal(compareProductVersions("0.321.2", "0.321.1") > 0, true);
  assert.equal(compareProductVersions("0.10.1", "0.9.9") > 0, true);
  assert.equal(compareProductVersions("0.1.1", "0.1.1"), 0);
  assert.throws(() => compareProductVersions("0.1.1-alpha.1", "0.1.1"), /numeric/);
});

test("rewrites generated metadata to exact GitHub assets", () => {
  const assetName = "Shift-0.1.1-macOS-arm64.zip";
  const assetBaseUrl = "https://github.com/shift-editor/shift/releases/download/v0.1.1";
  const rewritten = load(
    rewriteUpdateMetadata(
      dump({
        version: "0.1.1",
        files: [{ url: assetName, sha512: "hash", size: 4 }],
        path: assetName,
        sha512: "hash",
      }),
      "0.1.1",
      assetBaseUrl,
      new Set([assetName]),
    ),
  );

  assert.equal(rewritten.files[0].url, `${assetBaseUrl}/${assetName}`);
  assert.equal(rewritten.path, `${assetBaseUrl}/${assetName}`);
  assert.equal(rewritten.files[0].sha512, "hash");
});

test("stages generated Release metadata without a Windows channel", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-update-feed-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const artifactsRoot = path.join(root, "artifacts");
  const siteRoot = path.join(root, "site");
  await writeArtifacts(artifactsRoot);

  await prepareUpdateFeed({
    artifactsRoot,
    siteRoot,
    distribution: "release",
    version: "0.1.1",
    repository,
  });

  const armMetadata = load(
    await readFile(path.join(siteRoot, "updates/release/darwin/arm64/latest-mac.yml"), "utf8"),
  );
  assert.equal(armMetadata.version, "0.1.1");
  assert.equal(
    armMetadata.files[0].url,
    "https://github.com/shift-editor/shift/releases/download/v0.1.1/Shift-0.1.1-macOS-arm64.zip",
  );
  await assert.rejects(
    readFile(path.join(siteRoot, "updates/release/win32/x64/latest.yml")),
    /ENOENT/,
  );
});

test("stages Nightly macOS and Windows metadata", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-update-feed-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const artifactsRoot = path.join(root, "artifacts");
  const siteRoot = path.join(root, "site");
  await writeArtifacts(artifactsRoot, { version: "0.321.1", distribution: "nightly" });

  await prepareUpdateFeed({
    artifactsRoot,
    siteRoot,
    distribution: "nightly",
    version: "0.321.1",
    repository,
  });

  const windows = load(
    await readFile(path.join(siteRoot, "updates/nightly/win32/x64/latest.yml"), "utf8"),
  );
  assert.equal(windows.version, "0.321.1");
  assert.equal(
    windows.files[0].url,
    "https://github.com/shift-editor/shift/releases/download/nightly/Shift-Nightly-0.321.1-Windows-x64-Setup.exe",
  );
});

test("rejects non-monotonic candidates without changing the current feed", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-update-feed-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const first = path.join(root, "first");
  const stale = path.join(root, "stale");
  const siteRoot = path.join(root, "site");
  await writeArtifacts(first, { version: "0.1.2" });
  await writeArtifacts(stale, { version: "0.1.1" });
  await prepareUpdateFeed({
    artifactsRoot: first,
    siteRoot,
    distribution: "release",
    version: "0.1.2",
    repository,
  });
  const feedPath = path.join(siteRoot, "updates/release/darwin/arm64/latest-mac.yml");
  const current = await readFile(feedPath, "utf8");

  await assert.rejects(
    prepareUpdateFeed({
      artifactsRoot: stale,
      siteRoot,
      distribution: "release",
      version: "0.1.1",
      repository,
    }),
    /must advance from 0\.1\.2.*0\.1\.1/,
  );
  assert.equal(await readFile(feedPath, "utf8"), current);
});

test("rejects metadata whose version differs from the binary version", () => {
  assert.throws(
    () => rewriteUpdateMetadata("version: 0.1.2\nfiles: []\n", "0.1.1", "https://x", new Set()),
    /canonical version 0\.1\.1/,
  );
});
