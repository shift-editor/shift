import { readFile } from "node:fs/promises";
import semver from "semver";

const [currentPath, proposedVersion] = process.argv.slice(2);
if (!currentPath || !proposedVersion) {
  throw new Error("Usage: check-update-channel.mjs <current-feed> <proposed-version>");
}

const currentVersion = JSON.parse(await readFile(currentPath, "utf8")).name;
if (!semver.valid(currentVersion) || !semver.valid(proposedVersion)) {
  throw new Error(`Invalid update version: ${String(currentVersion)} or ${proposedVersion}`);
}
if (!semver.gt(proposedVersion, currentVersion)) {
  throw new Error(
    `Update feed must advance from ${currentVersion} to a newer version, received ${proposedVersion}`,
  );
}
