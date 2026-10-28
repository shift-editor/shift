import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { isSubjectTest, refactorChurn, testLedger, TsScan } from "./scan-ts.mjs";

/** Scans one file against `rustFunctions`; returns `kind detail` per finding. */
function scan(source, rustFunctions = []) {
  const scanner = new TsScan(new Set(rustFunctions));
  scanner.add("fixture.ts", source);
  return scanner.findings().map((finding) => `${finding.kind} ${finding.detail}`);
}

describe("rust-twin", () => {
  it("reports TypeScript that computes what a Rust function of the same name does", () => {
    const found = scan(
      `export function signedArea(points: readonly Point[]): number {
        let area = 0;
        for (let i = 0; i < points.length; i++) area += points[i].x * points[i + 1].y - points[i + 1].x;
        return area / 2;
      }`,
      ["signed_area"],
    );
    assert.equal(found.length, 1);
    assert.match(
      found[0],
      /^rust-twin signedArea computes \(weight \d+\); same name as fn signed_area/,
    );
  });

  it("ignores a same-named function that hands the work on", () => {
    const found = scan(
      `function joinContours(layer: Layer, ids: ContourId[]) { return engine.apply([{ kind: "joinContours", ids }]); }`,
      ["join_contours"],
    );
    assert.deepEqual(found, []);
  });
});

describe("method-candidate", () => {
  it("reports a free function whose first argument is a class of the codebase", () => {
    const found = scan(`export class Editor {}\nexport function zoomToFit(editor: Editor) {}`);
    assert.deepEqual(found, ["method-candidate zoomToFit takes Editor first"]);
  });
});

describe("wrapper-class", () => {
  it("reports classes named as wrappers", () => {
    const found = scan(`export class GlyphCache {}`);
    assert.deepEqual(found, [
      "wrapper-class GlyphCache: does it wrap the bridge or another store?",
    ]);
  });
});

describe("cross-object-chain", () => {
  it("reports an optional call result read again by another call", () => {
    const found = scan(`const layer = editor.glyphForId(id)?.layerForSource(sourceId) ?? null;`);
    assert.deepEqual(found, ["cross-object-chain editor.glyphForId(id)?.layerForSource(sourceId)"]);
  });
});

describe("repeated-filter", () => {
  it("reports the same predicate in two files", () => {
    const scanner = new TsScan(new Set());
    scanner.add("a.ts", `axes.filter((axis) => axis.role === "external");`);
    scanner.add("b.ts", `useAxes().filter((axis) => axis.role === "external");`);
    const found = scanner.findings().map((finding) => `${finding.path} ${finding.kind}`);
    assert.deepEqual(found, ["a.ts repeated-filter"]);
  });
});

describe("fallbacks", () => {
  it("reports a file leaning on ?? null and ?? []", () => {
    const found = scan(
      Array.from({ length: 5 }, (_, i) => `const v${i} = map.get(${i}) ?? null;`).join("\n"),
    );
    assert.deepEqual(found, ["fallbacks 5 `?? null` / `?? []` in this file"]);
  });
});

describe("conditional-spread", () => {
  it("reports a spread that chooses on a condition", () => {
    const found = scan(
      `const a = { ...(name ? { name } : {}) };\nconst b = { ...(open && { open }) };\nconst c = [...(isMac ? [] : [quit])];`,
    );
    assert.equal(found.length, 3);
    assert.ok(found.every((finding) => finding.startsWith("conditional-spread")));
  });

  it("ignores a plain spread", () => {
    assert.deepEqual(scan(`const a = { ...defaults, ...options };`), []);
  });
});

describe("nested-callbacks", () => {
  it("reports callbacks three deep once, at the outermost call", () => {
    const found = scan(
      `groups.forEach((group) => group.items.map((item) => item.points.filter((point) => point.on)));`,
    );
    assert.deepEqual(found, [
      "nested-callbacks 3 functions deep: groups.forEach((group) => group.items.map((item) => item.points.filter",
    ]);
  });

  it("counts handlers and returned functions, not only method callbacks", () => {
    const found = scan(
      `useEffect(() => { const stop = onZoom((zoom) => toasts.some((t) => t.id === zoom)); return () => stop(); });`,
    );
    assert.equal(found.length, 1);
    assert.match(found[0], /^nested-callbacks 3 functions deep: useEffect/);
  });

  it("starts counting inside a named arrow such as a component", () => {
    assert.deepEqual(scan(`const Panel = () => items.map((item) => item.id);`), []);
  });

  it("starts counting inside describe, it and hook bodies", () => {
    const found = scan(
      `describe("move", () => { beforeEach(() => {}); it.each(rows)("moves %s", (row) => rows.map((r) => r.id)); });`,
    );
    assert.deepEqual(found, []);
  });

  it("ignores two levels", () => {
    assert.deepEqual(scan(`groups.map((group) => group.items.map((item) => item.id));`), []);
  });
});

describe("tests", () => {
  it("are scanned like other code", () => {
    const scanner = new TsScan(new Set());
    scanner.add("fixture.test.ts", `export class FakeStore {}`);
    const found = scanner.findings().map((finding) => finding.kind);
    assert.deepEqual(found, ["wrapper-class"]);
  });

  it("are not reported as Rust twins, since a test recomputing a rule is its oracle", () => {
    const scanner = new TsScan(new Set(["signed_area"]));
    scanner.add(
      "geometry.test.ts",
      `function signedArea(points: Point[]) { let a = 0; for (const p of points) a += p.x * p.y - p.y; return a / 2; }`,
    );
    assert.deepEqual(scanner.findings(), []);
  });
});

/** Ledger details for one test file changed from `before` to `after`. */
function ledger(before, after) {
  return testLedger("move.test.ts", before, after).map((finding) => finding.detail);
}

describe("test-ledger", () => {
  it("reports removed and added cases by describe path", () => {
    const before = `describe("move", () => { it("moves one point", () => {}); it("moves two", () => {}); });`;
    const after = `describe("move", () => { it("moves one point", () => {}); test("snaps", () => {}); });`;
    assert.deepEqual(ledger(before, after), [
      "removed: move > moves two (was line 1)",
      "added: move > snaps",
    ]);
  });

  it("reports an exact matcher replaced by a weak one on the same subject", () => {
    const before = `it("counts", () => {\n  expect(glyph.points.length).toBe(4);\n  expect(name).toEqual("A");\n});`;
    const after = `it("counts", () => {\n  expect(glyph.points.length).toBeGreaterThan(0);\n  expect(name).toBeTruthy();\n});`;
    assert.deepEqual(ledger(before, after), [
      "weakened: counts: expect(glyph.points.length).toBe(4) became .toBeGreaterThan(0)",
      'weakened: counts: expect(name).toEqual("A") became .toBeTruthy()',
    ]);
  });

  it("reports a case that makes fewer expect calls", () => {
    const before = `it("moves", () => { expect(a).toBe(1); expect(b).toBe(2); });`;
    const after = `it("moves", () => { expect(a).toBe(1); });`;
    assert.deepEqual(ledger(before, after), ["fewer expects: moves (2 → 1)"]);
  });

  it("ignores a weak matcher added beside an exact one", () => {
    const before = `it("moves", () => { expect(point).toEqual({ x: 1 }); });`;
    const after = `it("moves", () => { expect(point).toBeDefined(); expect(point).toEqual({ x: 2 }); });`;
    assert.deepEqual(ledger(before, after), []);
  });

  it("summarises a new file and lists every case of a deleted one", () => {
    const file = `it("a", () => {});\nit("b", () => {});`;
    assert.deepEqual(ledger(null, file), ["new file with 2 cases"]);
    assert.deepEqual(ledger(file, null), ["removed: a (was line 1)", "removed: b (was line 2)"]);
  });
});

describe("refactor-churn", () => {
  const renderer = "apps/desktop/src/renderer/src/lib";
  const files = new Set([`${renderer}/model/Glyph.ts`, `${renderer}/tools/pen/Pen.tsx`]);
  const exists = (filePath) => files.has(filePath);

  it("tells subject tests (beside their file) from behaviour tests", () => {
    assert.equal(isSubjectTest(`${renderer}/model/Glyph.test.ts`, exists), true);
    assert.equal(isSubjectTest(`${renderer}/tools/pen/Pen.test.ts`, exists), true);
    assert.equal(isSubjectTest(`${renderer}/tools/pen/PenScaledText.test.ts`, exists), false);
  });

  it("lists behaviour tests under the renderer only", () => {
    const changes = [
      { status: "M", path: `${renderer}/model/Glyph.test.ts` },
      { status: "M", path: `${renderer}/tools/pen/PenScaledText.test.ts` },
      { status: "D", path: `${renderer}/behaviour/kerning.test.ts` },
      { status: "M", path: `${renderer}/model/Glyph.ts` },
      { status: "M", path: "packages/editor/src/lib/model/order.test.ts" },
    ];
    const found = refactorChurn(changes, exists).map((finding) => finding.detail);
    assert.deepEqual(found, ["behaviour test modified", "behaviour test deleted"]);
  });
});

describe("--since", () => {
  const script = fileURLToPath(new URL("./scan-ts.mjs", import.meta.url));
  const repo = mkdtempSync(path.join(tmpdir(), "scan-ts-since-"));
  after(() => rmSync(repo, { recursive: true, force: true }));

  const run = (command, args) => execFileSync(command, args, { cwd: repo, encoding: "utf8" });

  it("reads the repository of the working directory, not the script's", () => {
    const testFile = "apps/desktop/src/renderer/src/behaviour/move.test.ts";
    mkdirSync(path.join(repo, path.dirname(testFile)), { recursive: true });
    run("git", ["init", "-q"]);
    writeFileSync(
      path.join(repo, testFile),
      `it("moves", () => { expect(n).toBe(2); });\nit("snaps", () => {});\n`,
    );
    run("git", ["add", "."]);
    run("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base"]);
    writeFileSync(path.join(repo, testFile), `it("moves", () => { expect(n).toBeDefined(); });\n`);

    const output = run(process.execPath, [script, "--since", "HEAD", "--kind", "test-ledger"]);
    assert.deepEqual(output.trim().split("\n"), [
      `${testFile}:1\ttest-ledger\tweakened: moves: expect(n).toBe(2) became .toBeDefined()`,
      `${testFile}:1\ttest-ledger\tremoved: snaps (was line 2)`,
    ]);
  });
});
