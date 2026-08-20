import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { dump, load } from "js-yaml";
import { z } from "zod";

const versionPattern = /^\d+\.\d+\.\d+$/;
const versionSchema = z.string().regex(versionPattern);
const updateFileSchema = z.looseObject({
  url: z.string(),
  sha512: z.string(),
});
const updateMetadataSchema = z.looseObject({
  version: versionSchema,
  files: z.array(updateFileSchema).min(1),
  path: z.string().optional(),
});

export function compareProductVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

export function rewriteUpdateMetadata(source, version, assetBaseUrl, assetNames) {
  const metadata = parseUpdateMetadata(source, `metadata for ${version}`);
  if (metadata.version !== version) {
    throw new Error(`Update metadata does not use canonical version ${version}`);
  }

  for (const file of metadata.files) {
    const assetName = metadataAssetName(file.url);
    if (!assetName.includes(version)) {
      throw new Error(`Update asset does not contain version ${version}: ${assetName}`);
    }
    if (!assetNames.has(assetName)) {
      throw new Error(`Update metadata references a missing asset: ${assetName}`);
    }

    file.url = `${assetBaseUrl}/${encodeURIComponent(assetName)}`;
  }

  if (typeof metadata.path === "string") metadata.path = metadata.files[0].url;
  return dump(metadata, { lineWidth: -1, noRefs: true, sortKeys: false });
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
  const metadata = new Map();

  for (const architecture of ["arm64", "x64"]) {
    const source = await readFile(
      findMetadata(files, artifacts, `darwin-${architecture}`, "latest-mac.yml"),
      "utf8",
    );
    const macMetadata = rewriteUpdateMetadata(source, version, assetBaseUrl, assetNames);
    const mac = parseUpdateMetadata(macMetadata, `macOS ${architecture} metadata`);
    const zip = mac.files.find((file) => file.url.endsWith(".zip"));
    if (!zip) throw new Error(`macOS update metadata is missing a ZIP for ${architecture}`);
    const zipName = metadataAssetName(zip.url);
    if (!assetNames.has(`${zipName}.blockmap`)) {
      throw new Error(`macOS update is missing blockmap: ${zipName}.blockmap`);
    }
    metadata.set(`darwin-${architecture}`, macMetadata);
  }

  if (distribution === "nightly") {
    const source = await readFile(
      findMetadata(files, artifacts, "win32-x64", "latest.yml"),
      "utf8",
    );
    const windowsMetadata = rewriteUpdateMetadata(source, version, assetBaseUrl, assetNames);
    const windows = parseUpdateMetadata(windowsMetadata, "Windows x64 metadata");
    const installerName = metadataAssetName(windows.files[0].url);
    if (!assetNames.has(`${installerName}.blockmap`)) {
      throw new Error(`Windows update is missing blockmap: ${installerName}.blockmap`);
    }
    metadata.set("win32-x64", windowsMetadata);
  }

  const channelRoot = path.join(site, "updates", distribution);
  const currentMetadataPath = path.join(channelRoot, "darwin", "arm64", "latest-mac.yml");
  try {
    const current = parseUpdateMetadata(
      await readFile(currentMetadataPath, "utf8"),
      "current arm64 metadata",
    );
    if (compareProductVersions(version, current.version) <= 0) {
      throw new Error(
        `Update feed must advance from ${String(current.version)} to a newer version, received ${version}`,
      );
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  await Promise.all([
    write(
      path.join(channelRoot, "darwin", "arm64", "latest-mac.yml"),
      metadata.get("darwin-arm64"),
    ),
    write(path.join(channelRoot, "darwin", "x64", "latest-mac.yml"), metadata.get("darwin-x64")),
    distribution === "nightly"
      ? write(path.join(channelRoot, "win32", "x64", "latest.yml"), metadata.get("win32-x64"))
      : rm(path.join(channelRoot, "win32"), { recursive: true, force: true }),
    rm(path.join(channelRoot, "darwin", "arm64", "RELEASES.json"), { force: true }),
    rm(path.join(channelRoot, "darwin", "x64", "RELEASES.json"), { force: true }),
    rm(path.join(channelRoot, "win32", "x64", "RELEASES"), { force: true }),
  ]);
}

function parseVersion(version) {
  const result = versionSchema.safeParse(version);
  if (!result.success) {
    throw new Error(`Expected a numeric three-component version, received: ${version}`);
  }
  return result.data.split(".").map(Number);
}

function parseUpdateMetadata(source, context) {
  const result = updateMetadataSchema.safeParse(load(source));
  if (!result.success) {
    throw new Error(`Invalid update ${context}: ${result.error.message}`, { cause: result.error });
  }
  return result.data;
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

function findMetadata(files, root, target, name) {
  const matches = files.filter((file) => {
    const relative = relativePath(root, file);
    return path.basename(file) === name && relative.includes(target);
  });
  if (matches.length !== 1) {
    throw new Error(`Expected one ${target} ${name}, found ${matches.length}`);
  }
  return matches[0];
}

function metadataAssetName(url) {
  return decodeURIComponent(path.posix.basename(new URL(url, "https://metadata.invalid").pathname));
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
