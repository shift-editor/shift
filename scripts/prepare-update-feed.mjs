import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

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
if (!/^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(version)) {
  throw new Error(`Expected a prerelease semantic version, received: ${version}`);
}
if (Number.isNaN(Date.parse(publishedAt))) {
  throw new Error(`Expected an ISO publication time, received: ${publishedAt}`);
}

const privateKeySource = process.env.SHIFT_UPDATE_PRIVATE_KEY;
const expectedPublicKey = process.env.SHIFT_UPDATE_PUBLIC_KEY;
if (!privateKeySource || !expectedPublicKey) {
  throw new Error("SHIFT_UPDATE_PRIVATE_KEY and SHIFT_UPDATE_PUBLIC_KEY are required");
}

const privateKey = createPrivateKey({
  key: decodeBase64("private key", privateKeySource),
  format: "der",
  type: "pkcs8",
});
const publicKey = createPublicKey(privateKey)
  .export({ format: "der", type: "spki" })
  .toString("base64");
if (publicKey !== expectedPublicKey) {
  throw new Error("Update signing key does not match SHIFT_UPDATE_PUBLIC_KEY");
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
for (const file of [macArm64, macX64, windowsX64]) {
  if (!path.basename(file).includes(version)) {
    throw new Error(`Update artifact does not contain version ${version}: ${path.basename(file)}`);
  }
}

const repository = process.env.GITHUB_REPOSITORY ?? "shift-editor/shift";
const updateBaseUrl = (
  process.env.SHIFT_UPDATE_BASE_URL ?? "https://shift-editor.github.io/shift/updates"
).replace(/\/$/, "");
const releaseBaseUrl = `https://github.com/${repository}/releases/download/${encodeURIComponent(releaseTag)}`;
const versionBaseUrl = `${updateBaseUrl}/${distribution}/${encodeURIComponent(version)}`;

const macArm64Artifact = await artifact(macArm64, "darwin", "arm64", releaseBaseUrl, {
  feedUrl: `${versionBaseUrl}/darwin/arm64/RELEASES.json`,
});
const macX64Artifact = await artifact(macX64, "darwin", "x64", releaseBaseUrl, {
  feedUrl: `${versionBaseUrl}/darwin/x64/RELEASES.json`,
});
const windowsX64Artifact = await artifact(windowsX64, "win32", "x64", releaseBaseUrl, {
  feedUrl: `${versionBaseUrl}/win32/x64`,
});

const versionRoot = path.join(siteRoot, "updates", distribution, version);
try {
  await stat(versionRoot);
  throw new Error(`Update feed version already exists: ${distribution} ${version}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

await Promise.all([
  writeJson(path.join(versionRoot, "darwin", "arm64", "RELEASES.json"), {
    url: macArm64Artifact.url,
    name: version,
    notes: "",
    pub_date: publishedAt,
    sha256: macArm64Artifact.sha256,
    size: (await stat(macArm64)).size,
  }),
  writeJson(path.join(versionRoot, "darwin", "x64", "RELEASES.json"), {
    url: macX64Artifact.url,
    name: version,
    notes: "",
    pub_date: publishedAt,
    sha256: macX64Artifact.sha256,
    size: (await stat(macX64)).size,
  }),
  writeWindowsReleases(path.join(versionRoot, "win32", "x64", "RELEASES"), windowsX64),
]);

const payload = Buffer.from(
  JSON.stringify({
    schemaVersion: 1,
    distribution,
    version,
    publishedAt,
    releaseUrl: `https://github.com/${repository}/releases/tag/${encodeURIComponent(releaseTag)}`,
    artifacts: [macArm64Artifact, macX64Artifact, windowsX64Artifact],
  }),
);
const envelope = {
  payload: payload.toString("base64"),
  signature: sign(null, payload, privateKey).toString("base64"),
};
const channelPath = path.join(siteRoot, "updates", distribution, "channel.json");
await mkdir(path.dirname(channelPath), { recursive: true });
const temporaryChannelPath = `${channelPath}.next`;
await writeFile(temporaryChannelPath, `${JSON.stringify(envelope, null, 2)}\n`);
await rename(temporaryChannelPath, channelPath);

async function artifact(file, platform, architecture, releaseBase, options) {
  return {
    platform,
    architecture,
    feedUrl: options.feedUrl,
    url: `${releaseBase}/${encodeURIComponent(path.basename(file))}`,
    sha256: await digest(file, "sha256"),
  };
}

async function writeWindowsReleases(destination, nupkg) {
  await mkdir(path.dirname(destination), { recursive: true });
  const sha1 = (await digest(nupkg, "sha1")).toUpperCase();
  const size = (await stat(nupkg)).size;
  const url = `${releaseBaseUrl}/${encodeURIComponent(path.basename(nupkg))}`;
  await writeFile(destination, `${sha1} ${url} ${size}\n`);
}

async function writeJson(destination, value) {
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`);
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

function decodeBase64(name, value) {
  const decoded = Buffer.from(value, "base64");
  if (
    decoded.length === 0 ||
    decoded.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")
  ) {
    throw new Error(`Update ${name} is not valid base64`);
  }
  return decoded;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
