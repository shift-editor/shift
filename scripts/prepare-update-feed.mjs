import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const versionPattern = /^\d+\.\d+\.\d+$/;

export function compareProductVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

export function validateMacManifest(manifest, version, expectedAssetBaseUrl) {
  if (manifest.currentRelease !== version || !Array.isArray(manifest.releases)) {
    throw new Error(`macOS manifest does not use canonical version ${version}`);
  }

  const release = manifest.releases.find(
    (candidate) => candidate.version === version && candidate.updateTo?.version === version,
  );
  if (!release) throw new Error(`macOS manifest is missing release ${version}`);

  const url = new URL(release.updateTo.url);
  if (!url.toString().startsWith(`${expectedAssetBaseUrl}/`)) {
    throw new Error(`macOS manifest has an unexpected update URL: ${url}`);
  }
  if (!decodeURIComponent(path.posix.basename(url.pathname)).includes(version)) {
    throw new Error(`macOS update asset does not contain version ${version}`);
  }

  return decodeURIComponent(path.posix.basename(url.pathname));
}

export function rewriteWindowsReleases(releases, assetBaseUrl, assetNames) {
  const lines = releases.trim().split("\n").filter(Boolean);
  if (lines.length === 0) throw new Error("Windows RELEASES is empty");

  return `${lines
    .map((line) => {
      const fields = line.trim().split(/\s+/);
      if (fields.length !== 3) throw new Error(`Invalid Windows RELEASES line: ${line}`);

      const packageName = path.win32.basename(fields[1]);
      if (!assetNames.has(packageName)) {
        throw new Error(`Windows RELEASES references a missing package: ${packageName}`);
      }

      return `${fields[0]} ${assetBaseUrl}/${encodeURIComponent(packageName)} ${fields[2]}`;
    })
    .join("\n")}\n`;
}

export async function prepareUpdateFeed({
  artifactsRoot,
  siteRoot,
  distribution,
  version,
  repository = "shift-editor/shift",
}) {
  if (distribution !== "release" && distribution !== "nightly") {
    throw new Error(`Expected release or nightly distribution, received: ${distribution}`);
  }
  parseVersion(version);

  const artifacts = path.resolve(artifactsRoot);
  const site = path.resolve(siteRoot);
  const files = await collectFiles(artifacts);
  const assetNames = new Set(files.map((file) => path.basename(file)));
  const releaseTag = distribution === "nightly" ? "nightly" : `v${version}`;
  const assetBaseUrl = `https://github.com/${repository}/releases/download/${releaseTag}`;

  const macManifests = new Map();
  for (const architecture of ["arm64", "x64"]) {
    const manifestPath = findOne(
      files,
      artifacts,
      `macOS ${architecture} RELEASES.json`,
      new RegExp(`(^|/)zip/darwin/${architecture}/RELEASES\\.json$`),
    );
    const source = await readFile(manifestPath, "utf8");
    const assetName = validateMacManifest(JSON.parse(source), version, assetBaseUrl);
    if (!assetNames.has(assetName)) {
      throw new Error(`macOS manifest references a missing asset: ${assetName}`);
    }
    macManifests.set(architecture, source);
  }

  const windowsManifestPath = findOne(
    files,
    artifacts,
    "Windows x64 RELEASES",
    /(^|\/)squirrel\.windows\/x64\/RELEASES$/,
  );
  const windowsPackages = new Set(
    files.filter((file) => /-full\.nupkg$/i.test(file)).map((file) => path.basename(file)),
  );
  if (windowsPackages.size !== 1) {
    throw new Error(`Expected one Windows x64 full NUPKG, found ${windowsPackages.size}`);
  }
  const [windowsPackage] = windowsPackages;
  if (!windowsPackage.includes(version)) {
    throw new Error(`Windows update asset does not contain version ${version}: ${windowsPackage}`);
  }
  const windowsManifest = rewriteWindowsReleases(
    await readFile(windowsManifestPath, "utf8"),
    assetBaseUrl,
    windowsPackages,
  );

  const channelRoot = path.join(site, "updates", distribution);
  const currentManifestPath = path.join(channelRoot, "darwin", "arm64", "RELEASES.json");
  try {
    const current = JSON.parse(await readFile(currentManifestPath, "utf8"));
    if (compareProductVersions(version, current.currentRelease) <= 0) {
      throw new Error(
        `Update feed must advance from ${String(current.currentRelease)} to a newer version, received ${version}`,
      );
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  await Promise.all([
    write(path.join(channelRoot, "darwin", "arm64", "RELEASES.json"), macManifests.get("arm64")),
    write(path.join(channelRoot, "darwin", "x64", "RELEASES.json"), macManifests.get("x64")),
    write(path.join(channelRoot, "win32", "x64", "RELEASES"), windowsManifest),
  ]);
}

function parseVersion(version) {
  if (!versionPattern.test(version)) {
    throw new Error(`Expected a numeric three-component version, received: ${version}`);
  }
  return version.split(".").map(Number);
}

async function collectFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(entryPath)));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function findOne(files, root, description, pattern) {
  const matches = files.filter((file) => pattern.test(relativePath(root, file)));
  if (matches.length !== 1) throw new Error(`Expected one ${description}, found ${matches.length}`);
  return matches[0];
}

function relativePath(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

async function write(destination, contents) {
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [artifactsRoot, siteRoot, distribution, version] = process.argv.slice(2);
  if (!artifactsRoot || !siteRoot || !distribution || !version) {
    throw new Error(
      "Usage: prepare-update-feed.mjs <artifacts> <site> <release|nightly> <version>",
    );
  }

  await prepareUpdateFeed({
    artifactsRoot,
    siteRoot,
    distribution,
    version,
    repository: process.env.GITHUB_REPOSITORY,
  });
}
