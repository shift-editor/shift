import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import { squirrelPackageVersion } from "./update-versions.mjs";

const [artifactsArgument, siteArgument, distribution, version, releaseTag, publishedAt] =
  process.argv.slice(2);
if (
  !artifactsArgument ||
  !siteArgument ||
  !distribution ||
  !version ||
  !releaseTag ||
  !publishedAt
) {
  throw new Error(
    "Usage: prepare-update-feed.mjs <artifacts> <site> <distribution> <version> <release-tag> <published-at>",
  );
}

if (distribution !== "release" && distribution !== "nightly") {
  throw new Error(`Expected release or nightly distribution, received: ${distribution}`);
}
if (!semver.valid(version)) {
  throw new Error(`Expected a semantic version, received: ${version}`);
}
if (Number.isNaN(Date.parse(publishedAt))) {
  throw new Error(`Expected an ISO publication time, received: ${publishedAt}`);
}

const artifactsRoot = path.resolve(artifactsArgument);
const siteRoot = path.resolve(siteArgument);
const files = await collectFiles(artifactsRoot);
const macArm64 = findOne(
  files,
  artifactsRoot,
  "macOS arm64 ZIP",
  (relative) =>
    /(^|\/)zip\/darwin\/arm64\/[^/]+\.zip$/.test(relative) ||
    new RegExp(`${escapeRegex(version)}-macOS-arm64\\.zip$`).test(relative),
);
const macX64 = findOne(
  files,
  artifactsRoot,
  "macOS x64 ZIP",
  (relative) =>
    /(^|\/)zip\/darwin\/x64\/[^/]+\.zip$/.test(relative) ||
    new RegExp(`${escapeRegex(version)}-macOS-x64\\.zip$`).test(relative),
);
const windowsX64 = findOne(
  files,
  artifactsRoot,
  "Windows x64 full NUPKG",
  (relative) =>
    /(^|\/)squirrel\.windows\/x64\/[^/]+-full\.nupkg$/.test(relative) ||
    /(^|\/)[^/]+-full\.nupkg$/.test(relative),
);
for (const file of [macArm64, macX64]) {
  if (!path.basename(file).includes(version)) {
    throw new Error(`Update artifact does not contain version ${version}: ${path.basename(file)}`);
  }
}
const windowsVersion = squirrelPackageVersion(version);
if (!path.basename(windowsX64).includes(windowsVersion)) {
  throw new Error(
    `Update artifact does not contain version ${windowsVersion}: ${path.basename(windowsX64)}`,
  );
}

const repository = process.env.GITHUB_REPOSITORY ?? "shift-editor/shift";
const releaseBaseUrl = `https://github.com/${repository}/releases/download/${encodeURIComponent(releaseTag)}`;
const versionRoot = path.join(siteRoot, "updates", distribution, version);
try {
  await stat(versionRoot);
  throw new Error(`Update feed version already exists: ${distribution} ${version}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const currentMacFeed = path.join(
  siteRoot,
  "updates",
  distribution,
  "darwin",
  "arm64",
  "RELEASES.json",
);
try {
  const current = JSON.parse(await readFile(currentMacFeed, "utf8"));
  if (!semver.valid(current.name) || !semver.gt(version, current.name)) {
    throw new Error(
      `Update feed must advance from ${String(current.name)} to a newer version, received ${version}`,
    );
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const macArm64Feed = await macFeed(macArm64);
const macX64Feed = await macFeed(macX64);
const windowsX64Feed = await windowsFeed(windowsX64);
await Promise.all([
  writeJson(path.join(versionRoot, "darwin", "arm64", "RELEASES.json"), macArm64Feed),
  writeJson(path.join(versionRoot, "darwin", "x64", "RELEASES.json"), macX64Feed),
  writeText(path.join(versionRoot, "win32", "x64", "RELEASES"), windowsX64Feed),
  writeJson(currentMacFeed, macArm64Feed),
  writeJson(
    path.join(siteRoot, "updates", distribution, "darwin", "x64", "RELEASES.json"),
    macX64Feed,
  ),
  writeText(
    path.join(siteRoot, "updates", distribution, "win32", "x64", "RELEASES"),
    windowsX64Feed,
  ),
]);

async function macFeed(file) {
  return {
    url: `${releaseBaseUrl}/${encodeURIComponent(path.basename(file))}`,
    name: version,
    notes: "",
    pub_date: publishedAt,
    sha256: await digest(file, "sha256"),
    size: (await stat(file)).size,
  };
}

async function windowsFeed(nupkg) {
  const sha1 = (await digest(nupkg, "sha1")).toUpperCase();
  const size = (await stat(nupkg)).size;
  const url = `${releaseBaseUrl}/${encodeURIComponent(path.basename(nupkg))}`;
  return `${sha1} ${url} ${size}\n`;
}

async function writeJson(destination, value) {
  await writeText(destination, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(destination, value) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.next`;
  await writeFile(temporary, value);
  await rename(temporary, destination);
}

async function collectFiles(root) {
  const collected = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) collected.push(...(await collectFiles(entryPath)));
    else if (entry.isFile()) collected.push(entryPath);
  }
  return collected;
}

function findOne(allFiles, root, description, predicate) {
  const matches = allFiles.filter((file) => predicate(relativePath(root, file)));
  if (matches.length !== 1) {
    throw new Error(`Expected one ${description}, found ${matches.length}`);
  }
  return matches[0];
}

function relativePath(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

async function digest(file, algorithm) {
  const hash = createHash(algorithm);
  await new Promise((resolve, reject) => {
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", resolve)
      .on("error", reject);
  });
  return hash.digest("hex");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
