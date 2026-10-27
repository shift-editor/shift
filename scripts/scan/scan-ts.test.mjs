import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TsScan } from "./scan-ts.mjs";

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

  it("ignores two levels", () => {
    assert.deepEqual(scan(`groups.map((group) => group.items.map((item) => item.id));`), []);
  });
});

describe("tests", () => {
  it("are not scanned", () => {
    const scanner = new TsScan(new Set());
    scanner.add("fixture.test.ts", `export class FakeStore {}`);
    assert.deepEqual(scanner.findings(), []);
  });
});
