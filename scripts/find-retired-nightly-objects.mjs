import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const commitPattern = /^[0-9a-f]{40}$/;
const nightlyKeyPattern = /^nightly\/(?<commit>[0-9a-f]{40})\//;

export function findRetiredNightlyObjects(objects, activeCommit, retentionDays, now = new Date()) {
  if (!commitPattern.test(activeCommit)) {
    throw new Error(`Expected a full lowercase commit SHA, received: ${activeCommit}`);
  }
  if (!Number.isInteger(retentionDays) || retentionDays < 0) {
    throw new Error(`Expected non-negative retention days, received: ${retentionDays}`);
  }
  if (!Array.isArray(objects)) throw new Error("Expected an R2 object array");

  const builds = new Map();
  for (const object of objects) {
    if (!object || typeof object.Key !== "string") throw new Error("R2 objects must provide a Key");
    const commit = nightlyKeyPattern.exec(object.Key)?.groups?.commit;
    if (!commit) continue;
    if (typeof object.LastModified !== "string") {
      throw new Error(`R2 Nightly object must provide LastModified: ${object.Key}`);
    }

    const modifiedAt = Date.parse(object.LastModified);
    if (Number.isNaN(modifiedAt)) {
      throw new Error(`Invalid R2 modification time for ${object.Key}: ${object.LastModified}`);
    }

    const build = builds.get(commit) ?? { latestModification: Number.NEGATIVE_INFINITY, keys: [] };
    build.latestModification = Math.max(build.latestModification, modifiedAt);
    build.keys.push(object.Key);
    builds.set(commit, build);
  }

  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return [...builds]
    .filter(([commit, build]) => commit !== activeCommit && build.latestModification < cutoff)
    .flatMap(([, build]) => build.keys)
    .sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [objectsPath, activeCommit, retentionArgument] = process.argv.slice(2);
  if (!objectsPath || !activeCommit || retentionArgument === undefined) {
    throw new Error(
      "Usage: find-retired-nightly-objects.mjs <r2-objects-json> <active-commit> <retention-days>",
    );
  }

  const listing = JSON.parse(await readFile(path.resolve(objectsPath), "utf8"));
  const retired = findRetiredNightlyObjects(
    listing.Contents ?? [],
    activeCommit,
    Number(retentionArgument),
  );
  if (retired.length > 0) process.stdout.write(`${retired.join("\n")}\n`);
}
