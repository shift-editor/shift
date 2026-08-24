import assert from "node:assert/strict";
import test from "node:test";
import { findRetiredNightlyObjects } from "./find-retired-nightly-objects.mjs";

const activeCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const retiredCommit = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const recentCommit = "cccccccccccccccccccccccccccccccccccccccc";
const now = new Date("2026-08-24T12:00:00Z");

function object(commit, name, LastModified) {
  return { Key: `nightly/${commit}/${name}`, LastModified };
}

test("retires complete inactive prefixes after 14 days", () => {
  const objects = [
    object(retiredCommit, "package.zip", "2026-08-10T11:00:00Z"),
    object(retiredCommit, "manifest.json", "2026-08-10T11:59:59Z"),
    object(recentCommit, "package.zip", "2026-08-10T11:00:00Z"),
    object(recentCommit, "manifest.json", "2026-08-10T12:00:00Z"),
    { Key: "release/v0.1.0/package.zip", LastModified: "2026-01-01T00:00:00Z" },
  ];

  assert.deepEqual(findRetiredNightlyObjects(objects, activeCommit, 14, now), [
    `nightly/${retiredCommit}/manifest.json`,
    `nightly/${retiredCommit}/package.zip`,
  ]);
});

test("never retires the active prefix", () => {
  const objects = [
    object(activeCommit, "package.zip", "2026-01-01T00:00:00Z"),
    object(activeCommit, "manifest.json", "2026-01-01T00:00:01Z"),
  ];

  assert.deepEqual(findRetiredNightlyObjects(objects, activeCommit, 14, now), []);
});
