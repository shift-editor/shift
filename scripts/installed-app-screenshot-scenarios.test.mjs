import assert from "node:assert/strict";
import test from "node:test";
import {
  createFileDialogs,
  createMessageDialogs,
  message,
  screenshotManifest,
} from "./installed-app-screenshot-scenarios.mjs";

test("installed screenshot scenarios have unique manifest entries", () => {
  const fileNames = screenshotManifest.map(({ fileName }) => fileName);
  const labels = screenshotManifest.map(({ label }) => label);

  assert.equal(screenshotManifest.length, 33);
  assert.equal(new Set(fileNames).size, fileNames.length);
  assert.equal(new Set(labels).size, labels.length);
  assert.ok(fileNames.every((fileName) => fileName.endsWith(".png")));
});

test("every native dialog scenario is included in the screenshot manifest", () => {
  const manifestFiles = new Set(screenshotManifest.map(({ fileName }) => fileName));
  const scenarios = [
    ...createFileDialogs("/tmp/shift-screenshot-test"),
    ...createMessageDialogs("Shift", "1.2.3"),
  ];

  assert.equal(scenarios.length, 16);
  for (const scenario of scenarios) {
    assert.ok(
      manifestFiles.has(scenario.fileName),
      `${scenario.fileName} is missing from the manifest`,
    );
    assert.doesNotMatch(JSON.stringify(scenario.options), /\{\w+\}/);
  }
});

test("screenshot copy uses the shared message catalog formatter", () => {
  assert.equal(
    message("document.createFailed.detail", { applicationName: "Shift" }),
    "Try again. If the problem continues, restart Shift.",
  );
  assert.throws(() => message("document.createFailed.detail"), /Missing message value/);
  assert.throws(() => message("missing.message"), /Unknown message ID/);
});
