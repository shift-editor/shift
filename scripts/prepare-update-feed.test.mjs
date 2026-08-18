import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  compareProductVersions,
  prepareUpdateFeed,
  rewriteWindowsReleases,
  validateMacManifest,
} from "./prepare-update-feed.mjs";

const repository = "shift-editor/shift";

async function writeArtifacts(root, version = "0.1.1") {
  const releaseTag = `v${version}`;
  for (const architecture of ["arm64", "x64"]) {
    const zipName = `Shift-darwin-${architecture}-${version}.zip`;
    const directory = path.join(root, "zip", "darwin", architecture);
    const manifest = {
      currentRelease: version,
      releases: [
        {
          version,
          updateTo: {
            name: `Shift v${version}`,
            version,
            pub_date: "2026-08-16T12:00:00.000Z",
            url: `https://github.com/${repository}/releases/download/${releaseTag}/${zipName}`,
            notes: "",
          },
        },
      ],
    };
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, zipName), architecture);
    await writeFile(path.join(directory, "RELEASES.json"), JSON.stringify(manifest));
  }

  const windowsDirectory = path.join(root, "squirrel.windows", "x64");
  const packageName = `shift-${version}-full.nupkg`;
  await mkdir(windowsDirectory, { recursive: true });
  await writeFile(path.join(windowsDirectory, packageName), "windows");
  await writeFile(path.join(windowsDirectory, "RELEASES"), `HASH ${packageName} 7\n`);
}

test("compares canonical product versions numerically", () => {
  assert.equal(compareProductVersions("0.321.2", "0.321.1") > 0, true);
  assert.equal(compareProductVersions("0.10.1", "0.9.9") > 0, true);
  assert.equal(compareProductVersions("0.1.1", "0.1.1"), 0);
  assert.throws(() => compareProductVersions("0.1.1-alpha.1", "0.1.1"), /numeric/);
});

test("validates Forge manifests and rewrites Windows package URLs", () => {
  const assetBaseUrl = "https://github.com/shift-editor/shift/releases/download/v0.1.1";
  const manifest = {
    currentRelease: "0.1.1",
    releases: [
      {
        version: "0.1.1",
        updateTo: {
          version: "0.1.1",
          url: `${assetBaseUrl}/Shift-darwin-arm64-0.1.1.zip`,
        },
      },
    ],
  };

  assert.equal(
    validateMacManifest(manifest, "0.1.1", assetBaseUrl),
    "Shift-darwin-arm64-0.1.1.zip",
  );
  assert.equal(
    rewriteWindowsReleases(
      "HASH shift-0.1.1-full.nupkg 7\n",
      assetBaseUrl,
      new Set(["shift-0.1.1-full.nupkg"]),
    ),
    `HASH ${assetBaseUrl}/shift-0.1.1-full.nupkg 7\n`,
  );
});

test("stages Forge manifests into fixed channel paths", async (context) => {
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

  const armManifest = JSON.parse(
    await readFile(path.join(siteRoot, "updates/release/darwin/arm64/RELEASES.json"), "utf8"),
  );
  assert.equal(armManifest.currentRelease, "0.1.1");
  assert.equal(armManifest.releases[0].updateTo.version, "0.1.1");
  assert.equal(
    await readFile(path.join(siteRoot, "updates/release/win32/x64/RELEASES"), "utf8"),
    "HASH https://github.com/shift-editor/shift/releases/download/v0.1.1/shift-0.1.1-full.nupkg 7\n",
  );
  await assert.rejects(
    readFile(path.join(siteRoot, "updates/release/0.1.1/darwin/arm64/RELEASES.json")),
    /ENOENT/,
  );
});

test("rejects non-monotonic candidates without changing the current feed", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shift-update-feed-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const first = path.join(root, "first");
  const stale = path.join(root, "stale");
  const siteRoot = path.join(root, "site");
  await writeArtifacts(first, "0.1.2");
  await writeArtifacts(stale, "0.1.1");
  await prepareUpdateFeed({
    artifactsRoot: first,
    siteRoot,
    distribution: "release",
    version: "0.1.2",
    repository,
  });
  const feedPath = path.join(siteRoot, "updates/release/darwin/arm64/RELEASES.json");
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

test("rejects a manifest whose version differs from the binary version", () => {
  assert.throws(
    () => validateMacManifest({ currentRelease: "0.1.2", releases: [] }, "0.1.1", "https://x"),
    /canonical version 0\.1\.1/,
  );
});
