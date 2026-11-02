import assert from "node:assert/strict";
import test from "node:test";
import { baselineOf, compare, countHits, failures, formatBaseline } from "./clippy-ratchet.mjs";

const FONT = "path+file:///repo/crates/shift-font#0.1.0";
const NAMES = new Map([[FONT, "shift-font"]]);
const LINTS = new Set(["expect_used"]);

/** A cargo `compiler-message` record as `--message-format=json` prints it. */
function message({
  code,
  level = "warning",
  file = "crates/shift-font/src/lib.rs",
  line = 1,
  kind = "lib",
}) {
  return {
    reason: "compiler-message",
    package_id: FONT,
    target: { kind: [kind], test: true },
    message: {
      code: code ? { code } : null,
      level,
      rendered: `${level}: ${code} at ${file}:${line}\n`,
      spans: [{ is_primary: true, file_name: file, line_start: line, column_start: 5 }],
    },
  };
}

test("a hit the lib and its unit-test build both report is one src hit", () => {
  const hit = message({ code: "clippy::expect_used" });
  const counts = countHits([hit, hit], LINTS, NAMES);
  assert.deepEqual(counts, { expect_used: { "shift-font": { src: 1, tests: 0 } } });
});

test("a hit only the unit-test build reports is test code", () => {
  const inCfgTest = message({ code: "clippy::expect_used" });
  const counts = countHits([inCfgTest], LINTS, NAMES);
  assert.deepEqual(counts, { expect_used: { "shift-font": { src: 0, tests: 1 } } });
});

test("hits in integration tests and examples are test code", () => {
  const inTest = message({
    code: "clippy::expect_used",
    file: "crates/shift-font/tests/a.rs",
    kind: "test",
  });
  const inExample = message({
    code: "clippy::expect_used",
    file: "crates/shift-font/examples/b.rs",
    kind: "example",
  });
  const counts = countHits([inTest, inTest, inExample], LINTS, NAMES);
  assert.deepEqual(counts, { expect_used: { "shift-font": { src: 0, tests: 2 } } });
});

test("a count above the baseline rose, below it fell, and none left clears the lint", () => {
  const baseline = { expect_used: { "shift-font": { src: 2, tests: 1 } } };

  const higher = compare(baseline, { expect_used: { "shift-font": { src: 3, tests: 1 } } });
  assert.deepEqual(higher.rose, ["clippy::expect_used in shift-font (src): 2 -> 3"]);
  assert.deepEqual(higher.fell, []);

  const cleared = compare(baseline, {});
  assert.equal(cleared.fell.length, 2);
  assert.deepEqual(cleared.cleared, ["expect_used"]);
});

test("a hit in a crate the baseline doesn't list rose from zero", () => {
  const { rose } = compare(
    { expect_used: {} },
    { expect_used: { "shift-font": { src: 0, tests: 1 } } },
  );
  assert.deepEqual(rose, ["clippy::expect_used in shift-font (tests): 0 -> 1"]);
});

test("the gate fails on errors and other warnings but not on ratcheted lints", () => {
  const ratcheted = message({ code: "clippy::expect_used" });
  const other = message({ code: "clippy::needless_collect", line: 2 });
  const error = message({ code: "E0308", level: "error", line: 3 });
  assert.deepEqual(failures([ratcheted, other, error], LINTS), [
    other.message.rendered,
    error.message.rendered,
  ]);
});

test("the written baseline keeps every listed lint, even one at zero", () => {
  const counts = { expect_used: { "shift-font": { src: 1, tests: 0 } } };
  assert.deepEqual(baselineOf(["unwrap_used", "expect_used"], counts), {
    expect_used: { "shift-font": { src: 1, tests: 0 } },
    unwrap_used: {},
  });
});

test("the baseline file is JSON with one line per crate", () => {
  const baseline = { expect_used: { "shift-font": { src: 1, tests: 2 } }, unwrap_used: {} };
  const text = formatBaseline(baseline);
  assert.deepEqual(JSON.parse(text), baseline);
  assert.match(text, /^ {4}"shift-font": \{ "src": 1, "tests": 2 \}$/m);
});
