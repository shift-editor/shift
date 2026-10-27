import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const oxlint = path.join(repoRoot, "node_modules", ".bin", "oxlint");
const plugin = fileURLToPath(new URL("./shift-plugin.mjs", import.meta.url));
const workDir = mkdtempSync(path.join(tmpdir(), "shift-plugin-test-"));

after(() => rmSync(workDir, { recursive: true, force: true }));

/** Lints `source` with only `rule` enabled; returns the 1-based lines it reports. */
function reportedLines(rule, source) {
  const config = path.join(workDir, `${rule}.oxlintrc.json`);
  writeFileSync(
    config,
    JSON.stringify({ jsPlugins: [plugin], rules: { [`shift/${rule}`]: "error" } }),
  );
  const file = path.join(workDir, "fixture.ts");
  writeFileSync(file, source);

  let output;
  try {
    output = execFileSync(oxlint, ["-c", config, "--format", "json", file], { encoding: "utf8" });
  } catch (error) {
    // oxlint exits non-zero when it reports errors; the report is still on stdout.
    output = error.stdout;
  }

  return JSON.parse(output)
    .diagnostics.filter((diagnostic) => diagnostic.code === `shift(${rule})`)
    .map((diagnostic) => diagnostic.labels[0].span.line);
}

describe("shift/no-inline-comparator", () => {
  it("flags arrow and function comparators passed to sort and toSorted", () => {
    const lines = reportedLines(
      "no-inline-comparator",
      [
        "declare const values: number[];",
        "values.sort((a, b) => a - b);",
        "values.toSorted((a, b) => b - a);",
        "values.sort(function (a, b) { return a - b; });",
      ].join("\n"),
    );

    assert.deepEqual(lines, [2, 3, 4]);
  });

  it("allows named comparators, comparator factories and the default order", () => {
    const lines = reportedLines(
      "no-inline-comparator",
      [
        "declare const values: number[];",
        "declare const ascending: (a: number, b: number) => number;",
        "declare const byAxis: (axis: string) => (a: number, b: number) => number;",
        "declare const keys: { order: (a: number, b: number) => number };",
        "values.sort(ascending);",
        "values.toSorted(byAxis('x'));",
        "values.sort(keys.order);",
        "values.toSorted();",
        "values.filter((value) => value > 0);",
      ].join("\n"),
    );

    assert.deepEqual(lines, []);
  });
});
