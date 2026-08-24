import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const versionPattern = /^\d+\.\d+\.\d+$/;
const versionedAssetPattern =
  /^Shift-Nightly-(?<version>\d+\.\d+\.\d+)-(?:macOS-(?:arm64|x64)\.(?:zip(?:\.blockmap)?|dmg)|Windows-x64-Setup\.exe(?:\.blockmap)?|Linux-x64\.(?:deb|rpm))$/;
const legacyAssetNames = new Set([
  "Shift-Nightly-macOS-arm64.zip",
  "Shift-Nightly-macOS-x64.zip",
  "Shift-Nightly-macOS-arm64.dmg",
  "Shift-Nightly-macOS-x64.dmg",
  "Shift-Nightly-Windows-x64.exe",
  "Shift-Nightly-Linux-x64.deb",
  "Shift-Nightly-Linux-x64.rpm",
]);

export function findObsoleteNightlyAssets(
  assets,
  activeVersion,
  blockmapRetentionDays,
  now = new Date(),
) {
  if (!versionPattern.test(activeVersion)) {
    throw new Error(
      `Expected a numeric three-component active version, received: ${activeVersion}`,
    );
  }
  if (!Number.isInteger(blockmapRetentionDays) || blockmapRetentionDays < 0) {
    throw new Error(
      `Expected non-negative blockmap retention days, received: ${blockmapRetentionDays}`,
    );
  }
  if (!Array.isArray(assets)) throw new Error("Expected a release asset array");

  const blockmapCutoff = now.getTime() - blockmapRetentionDays * 24 * 60 * 60 * 1000;
  const obsolete = [];

  for (const asset of assets) {
    if (!asset || typeof asset.name !== "string" || typeof asset.createdAt !== "string") {
      throw new Error("Release assets must provide name and createdAt strings");
    }
    if (legacyAssetNames.has(asset.name)) {
      obsolete.push(asset.name);
      continue;
    }

    const match = versionedAssetPattern.exec(asset.name);
    if (!match?.groups || match.groups.version === activeVersion) continue;
    if (!asset.name.endsWith(".blockmap")) {
      obsolete.push(asset.name);
      continue;
    }

    const createdAt = Date.parse(asset.createdAt);
    if (Number.isNaN(createdAt)) {
      throw new Error(`Invalid release asset creation time for ${asset.name}: ${asset.createdAt}`);
    }
    if (createdAt < blockmapCutoff) obsolete.push(asset.name);
  }

  return obsolete.sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [assetsPath, activeVersion, retentionArgument] = process.argv.slice(2);
  const blockmapRetentionDays = Number(retentionArgument);
  if (!assetsPath || !activeVersion || retentionArgument === undefined) {
    throw new Error(
      "Usage: find-obsolete-nightly-assets.mjs <release-assets-json> <active-version> <blockmap-retention-days>",
    );
  }

  const release = JSON.parse(await readFile(path.resolve(assetsPath), "utf8"));
  const obsolete = findObsoleteNightlyAssets(release.assets, activeVersion, blockmapRetentionDays);
  if (obsolete.length > 0) process.stdout.write(`${obsolete.join("\n")}\n`);
}
