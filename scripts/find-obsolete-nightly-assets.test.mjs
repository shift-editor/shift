import assert from "node:assert/strict";
import test from "node:test";
import { findObsoleteNightlyAssets } from "./find-obsolete-nightly-assets.mjs";

const activeVersion = "0.18.1";
const now = new Date("2026-08-23T12:00:00Z");

function asset(name, createdAt = "2026-08-23T06:00:00Z") {
  return { name, createdAt };
}

test("retires legacy aliases and inactive versioned binaries", () => {
  const assets = [
    asset("SHA256SUMS"),
    asset("Shift-Nightly-macOS-arm64.dmg"),
    asset(`Shift-Nightly-${activeVersion}-macOS-arm64.dmg`),
    asset("Shift-Nightly-0.17.1-macOS-arm64.dmg"),
    asset("Shift-Nightly-0.17.1-Windows-x64-Setup.exe"),
    asset("unrelated-debug-symbols.zip"),
  ];

  assert.deepEqual(findObsoleteNightlyAssets(assets, activeVersion, 14, now), [
    "Shift-Nightly-0.17.1-Windows-x64-Setup.exe",
    "Shift-Nightly-0.17.1-macOS-arm64.dmg",
    "Shift-Nightly-macOS-arm64.dmg",
  ]);
});

test("retains recent inactive blockmaps for differential updates", () => {
  const assets = [
    asset(`Shift-Nightly-${activeVersion}-macOS-arm64.zip.blockmap`, "2026-07-01T00:00:00Z"),
    asset("Shift-Nightly-0.17.1-macOS-arm64.zip.blockmap", "2026-08-10T12:00:00Z"),
    asset("Shift-Nightly-0.16.1-macOS-arm64.zip.blockmap", "2026-08-09T11:59:59Z"),
    asset("Shift-Nightly-0.16.1-Windows-x64-Setup.exe.blockmap", "2026-08-09T11:59:59Z"),
  ];

  assert.deepEqual(findObsoleteNightlyAssets(assets, activeVersion, 14, now), [
    "Shift-Nightly-0.16.1-Windows-x64-Setup.exe.blockmap",
    "Shift-Nightly-0.16.1-macOS-arm64.zip.blockmap",
  ]);
});
