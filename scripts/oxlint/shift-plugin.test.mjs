import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const oxlint = path.join(repoRoot, "node_modules", ".bin", "oxlint");
const plugin = fileURLToPath(new URL("./shift-plugin.mjs", import.meta.url));
const workDir = mkdtempSync(path.join(tmpdir(), "shift-plugin-test-"));

after(() => rmSync(workDir, { recursive: true, force: true }));

/**
 * Lints `source` with only `rule` enabled; returns the 1-based lines it reports.
 *
 * @param fileName - Where the source lives, relative to a scratch root, for rules scoped by path.
 */
function reportedLines(rule, source, fileName = "fixture.ts") {
  const config = path.join(workDir, `${rule}.oxlintrc.json`);
  writeFileSync(
    config,
    JSON.stringify({ jsPlugins: [plugin], rules: { [`shift/${rule}`]: "error" } }),
  );
  const file = path.join(workDir, fileName);
  mkdirSync(path.dirname(file), { recursive: true });
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
    .map((diagnostic) => diagnostic.labels[0].span.line)
    .toSorted((a, b) => a - b);
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

describe("shift/no-agent-types-in-behaviour-tests", () => {
  const imports = [
    'import type { AuthoredPoint } from "@shift/runtime";',
    'import type { ShiftCodeTypes } from "@shift/runtime/code-api";',
    'import { ShiftFontReader } from "@/agent/ShiftFontReader";',
    'import type { DrawnHandle } from "../../agent/ShiftEditorReader";',
    'export type { AuthoredLayer } from "@shift/runtime";',
    'const reader = await import("@/agent/ShiftKerningReader");',
    'import type { OutlinePoint } from "@/testing/reads";',
    'import type { EditorTestSurface } from "@/testing/surface";',
    'import { agentConnections } from "@/lib/agentConnections";',
    'import type { Agent } from "@shift/agents";',
  ].join("\n");

  it("flags runtime and agent imports in behaviour tests and E2E specs", () => {
    for (const fileName of [
      "apps/desktop/src/renderer/src/behaviour/editing/delete-and-fit.test.ts",
      "apps/desktop/src/renderer/src/behaviour/fixtures.ts",
      "apps/desktop/e2e/editor.spec.ts",
    ]) {
      assert.deepEqual(
        reportedLines("no-agent-types-in-behaviour-tests", imports, fileName),
        [1, 2, 3, 4, 5, 6],
        fileName,
      );
    }
  });

  it("allows them in the test surface, E2E fixtures, reader tests and app code", () => {
    for (const fileName of [
      "apps/desktop/src/renderer/src/testing/surface.ts",
      "apps/desktop/src/renderer/src/agent/ShiftFontReader.test.ts",
      "apps/desktop/e2e/fixtures/EditorDriver.ts",
      "apps/desktop/src/renderer/src/lib/editor.test.ts",
    ]) {
      assert.deepEqual(
        reportedLines("no-agent-types-in-behaviour-tests", imports, fileName),
        [],
        fileName,
      );
    }
  });
});

describe("shift/no-page-evaluate-in-specs", () => {
  const evaluations = [
    "declare const page: any;",
    "declare const electronApp: any;",
    "await page.evaluate(() => window.shift);",
    "await electronApp.evaluate(({ app }) => app.getName());",
    "await page.evaluateHandle(() => window);",
    "await page.waitForFunction(() => window.shift);",
    "await page.waitForURL(/home/);",
  ].join("\n");

  it("flags page, main-process and wait-for-function evaluations in a desktop E2E spec", () => {
    const lines = reportedLines(
      "no-page-evaluate-in-specs",
      evaluations,
      "apps/desktop/e2e/editor.spec.ts",
    );

    assert.deepEqual(lines, [3, 4, 5, 6]);
  });

  it("allows evaluations on locators, element handles and window handles", () => {
    const lines = reportedLines(
      "no-page-evaluate-in-specs",
      [
        "import type { Locator, ElementHandle } from '@playwright/test';",
        "declare const page: any;",
        "declare const electronApp: any;",
        "declare function helperCanvas(page: any): Locator;",
        "async function slider(page: any): Promise<Locator> { return page.getByRole('slider'); }",
        "await page.locator('#canvas').evaluate((element) => element.scrollTop);",
        "await page.getByRole('list').first().evaluate((element) => element.id);",
        "await page.locator('li').evaluateAll((items) => items.length);",
        "const grid = page.getByRole('grid');",
        "const viewport = grid;",
        "await viewport.evaluate((element) => element.scrollTop);",
        "const annotated: Locator = helperCanvas(page);",
        "await annotated.evaluate((element) => element.scrollTop);",
        "await (await slider(page)).evaluate((element) => element.value);",
        "async function focused(element: ElementHandle) { return element.evaluate((node) => node === document.activeElement); }",
        "const window = await electronApp.browserWindow(page);",
        "await window.evaluate((browserWindow) => browserWindow.isMaximized());",
        "await (await page.$('body')).evaluateHandle((body) => body);",
      ].join("\n"),
      "apps/desktop/e2e/editor.spec.ts",
    );

    assert.deepEqual(lines, []);
  });

  it("flags receivers it cannot prove are element-side", () => {
    const lines = reportedLines(
      "no-page-evaluate-in-specs",
      [
        "import { glyphCatalogCanvas } from './fixtures/appLocators';",
        "declare const page: any;",
        "declare const editor: any;",
        "const workspacePage = page;",
        "await workspacePage.evaluate(() => window.shift);",
        "const canvas = glyphCatalogCanvas(page);",
        "await canvas.evaluate((element) => element.scrollTop);",
        "await editor.page.evaluate(() => window.shift);",
        "await page.locator('#canvas').waitForFunction(() => true);",
      ].join("\n"),
      "apps/desktop/e2e/editor.spec.ts",
    );

    assert.deepEqual(lines, [5, 7, 8, 9]);
  });

  it("flags evaluations in E2E fixtures too", () => {
    for (const fileName of [
      "apps/desktop/e2e/fixtures/EditorDriver.ts",
      "apps/desktop/e2e/fixtures/renderCounter.mts",
    ]) {
      assert.deepEqual(
        reportedLines("no-page-evaluate-in-specs", evaluations, fileName),
        [3, 4, 5, 6],
        fileName,
      );
    }
  });

  it("allows evaluations only in the hook bridge and outside desktop E2E", () => {
    for (const fileName of [
      "apps/desktop/e2e/fixtures/appHooks.ts",
      "apps/desktop/src/renderer/src/editor.test.ts",
      "apps/web/e2e/landing.spec.ts",
    ]) {
      assert.deepEqual(
        reportedLines("no-page-evaluate-in-specs", evaluations, fileName),
        [],
        fileName,
      );
    }
  });
});

describe("shift/no-escape-hatch-reads", () => {
  it("flags reads from asEditor() and keeping its result", () => {
    const lines = reportedLines(
      "no-escape-hatch-reads",
      [
        "declare const editor: { asEditor(): { font: { name: string }; undo(): void } };",
        "editor.asEditor().font;",
        "editor.asEditor().undo();",
        "editor.asEditor()?.font;",
        'editor.asEditor()["font"];',
        "const raw = editor.asEditor();",
        "const { font } = editor.asEditor();",
      ].join("\n"),
    );

    assert.deepEqual(lines, [2, 3, 4, 5, 6, 7]);
  });

  it("allows asEditor() passed straight into a call", () => {
    const lines = reportedLines(
      "no-escape-hatch-reads",
      [
        "declare const editor: { asEditor(): object };",
        "declare function zoomToFit(editor: object): void;",
        "declare class Panel { constructor(editor: object) }",
        "zoomToFit(editor.asEditor());",
        "new Panel(editor.asEditor());",
        "expect(render(editor.asEditor(), 2)).toBe(true);",
        "editor.asEditorLike().font;",
      ].join("\n"),
    );

    assert.deepEqual(lines, []);
  });
});

describe("shift/no-test-type-escapes", () => {
  it("flags any casts, double casts and ts-ignore", () => {
    const lines = reportedLines(
      "no-test-type-escapes",
      [
        "declare const value: unknown;",
        "const a = value as any;",
        "const b = value as unknown as { font: string };",
        "// @ts-ignore",
        "const c: number = 'x';",
        "// @ts-expect-error",
        "const d: number = 'x';",
      ].join("\n"),
    );

    assert.deepEqual(lines, [2, 3, 4, 6]);
  });

  it("flags reads of members that are private by convention", () => {
    const lines = reportedLines(
      "no-test-type-escapes",
      [
        "declare const editor: Record<string, unknown>;",
        "editor._selection;",
        'editor["_selection"];',
        'editor["#selection"];',
      ].join("\n"),
    );

    assert.deepEqual(lines, [2, 3, 4]);
  });

  it("allows explained expect-errors, single casts, this._x and __x names", () => {
    const lines = reportedLines(
      "no-test-type-escapes",
      [
        "declare const value: unknown;",
        "declare const module: { __esModule: boolean; name: string };",
        "// @ts-expect-error a glyph name must be a string",
        "const a: number = 'x';",
        "const b = value as { font: string };",
        "const c = value as unknown;",
        "module.__esModule;",
        'module["name"];',
        "class Probe { _count = 0; read() { return this._count; } }",
      ].join("\n"),
    );

    assert.deepEqual(lines, []);
  });
});

describe("shift/no-wire-shapes-in-tests", () => {
  it("flags literals whose kind names their payload key", () => {
    const lines = reportedLines(
      "no-wire-shapes-in-tests",
      [
        "const edits = [",
        "  { kind: 'createGlyph', createGlyph: { name: 'A' } },",
        "  { 'kind': 'moveAnchors', 'moveAnchors': {} },",
        "];",
      ].join("\n"),
    );

    assert.deepEqual(lines, [2, 3]);
  });

  it("flags imports of the generated bridge types", () => {
    const lines = reportedLines(
      "no-wire-shapes-in-tests",
      [
        'import type { GlyphName } from "@shift/types/src/bridge/generated";',
        'import type { Unicode } from "../../types/src/bridge/generated.ts";',
        'export type { LayerId } from "./bridge/generated";',
      ].join("\n"),
    );

    assert.deepEqual(lines, [1, 2, 3]);
  });

  it("allows domain unions and kinds without a matching payload", () => {
    const lines = reportedLines(
      "no-wire-shapes-in-tests",
      [
        'import type { GlyphName } from "@shift/types";',
        'import { generated } from "./bridge/generatedFixtures";',
        "declare const point: object;",
        "const a = { kind: 'metric', metric: 'xHeight', y: 500 };",
        "const b = { kind: 'point', point };",
        "const c = { kind: 'createGlyph', glyph: { name: 'A' } };",
        "const d = { type: 'createGlyph', createGlyph: {} };",
      ].join("\n"),
    );

    assert.deepEqual(lines, []);
  });
});

describe("shift/no-conditional-spread", () => {
  it("flags a spread that picks an object or nothing", () => {
    const lines = reportedLines(
      "no-conditional-spread",
      [
        "declare const name: string | undefined;",
        "declare const open: boolean;",
        "const a = { ...(name === undefined ? {} : { name }) };",
        "const b = { ...(open ? { open } : {}) };",
        "const c = { ...(open && { open }) };",
      ].join("\n"),
    );

    assert.deepEqual(lines, [3, 4, 5]);
  });

  it("allows plain spreads, passed-through values, array spreads and a justified disable", () => {
    const lines = reportedLines(
      "no-conditional-spread",
      [
        "declare const name: string | undefined;",
        "declare const defaults: { name: string };",
        "declare const other: { name: string };",
        "declare const isMac: boolean;",
        "declare const quit: string;",
        "const a = { ...defaults, name: name === undefined ? undefined : name.trim() };",
        "const b = { ...(isMac ? defaults : other) };",
        "const c = [...(isMac ? [] : [quit])];",
        "// oxlint-disable-next-line shift/no-conditional-spread -- stored record omits the key",
        "const d = { ...(name === undefined ? {} : { name }) };",
      ].join("\n"),
    );

    assert.deepEqual(lines, []);
  });
});

describe("shift/no-lookup-in-tests", () => {
  const spec = "apps/desktop/e2e/lookups.spec.ts";
  const behaviour = "apps/desktop/src/renderer/src/behaviour/variation/lookups.test.ts";

  it("flags find, filter and some that compare a member or destructured key", () => {
    const source = [
      "declare const sources: { id: string; name: string }[];",
      "declare const id: string;",
      'sources.find((source) => source.name === "Bold");',
      "sources.filter(({ name }) => name !== id);",
      "sources.some(function (source) { return id === source.id; });",
    ].join("\n");

    assert.deepEqual(reportedLines("no-lookup-in-tests", source, spec), [3, 4, 5]);
    assert.deepEqual(reportedLines("no-lookup-in-tests", source, behaviour), [3, 4, 5]);
  });

  it("allows other predicates, other files and a justified disable", () => {
    const source = [
      "declare const values: number[];",
      "declare const sources: { name: string }[];",
      "values.filter((value) => value > 0);",
      "values.some((value) => value === 3);",
      'sources.map((source) => source.name === "Bold");',
      "// oxlint-disable-next-line shift/no-lookup-in-tests -- the read has no selector for this",
      'sources.find((source) => source.name === "Bold");',
    ].join("\n");

    assert.deepEqual(reportedLines("no-lookup-in-tests", source, spec), []);
    assert.deepEqual(
      reportedLines(
        "no-lookup-in-tests",
        'declare const s: { name: string }[];\ns.find((x) => x.name === "B");',
        "apps/desktop/e2e/fixtures/helpers.ts",
      ),
      [],
    );
  });
});

describe("shift/no-drill-into-reads", () => {
  const reads = [
    "declare const editor: {",
    "  spacingTool(): { hovered: { side: string } | null } | null;",
    "  outline(): Promise<{ points: { x: number }[] }[]>;",
    "  canvasText(): { items: { id: string }[]; caret: object | null } | null;",
    "};",
    "declare function expect(value: unknown, message?: string): any;",
  ];

  it("flags ?. chains, [n]! and read()!.x picks and .map projections of a read inside expect", () => {
    const lines = reportedLines(
      "no-drill-into-reads",
      [
        ...reads,
        'expect(editor.spacingTool()?.hovered?.side).toBe("left");',
        "expect((await editor.outline())[0]!.points).toHaveLength(3);",
        "expect(editor.canvasText()!.items).toHaveLength(1);",
        "expect(editor.canvasText()!.items.map(({ id }) => id)).toEqual([]);",
        'expect.soft(editor.canvasText()?.caret, "caret").toBeNull();',
        "await expect.poll(async () => (await editor.outline())[0]?.points).toHaveLength(3);",
        "await expect.poll(() => { return editor.canvasText()?.caret; }).toBeNull();",
      ].join("\n"),
    );

    assert.deepEqual(lines, [7, 8, 9, 10, 11, 12, 13]);
  });

  it("allows whole reads, picks made to act on a read, and picks in the expected value", () => {
    const lines = reportedLines(
      "no-drill-into-reads",
      [
        ...reads,
        'expect(editor.spacingTool()).toMatchObject({ hovered: { side: "left" } });',
        "expect(await editor.outline()).toMatchObject([{ points: [{ x: 1 }] }]);",
        "const [contour] = await editor.outline();",
        "const id = editor.canvasText()!.items[0]!.id;",
        "expect(editor.canvasText()).toMatchObject({ items: [{ id: editor.canvasText()?.items[0]?.id }] });",
        "expect(editor.spacingTool()).toBeNull();",
        "await expect.poll(() => editor.canvasText()).toMatchObject({ caret: null });",
      ].join("\n"),
    );

    assert.deepEqual(lines, []);
  });
});
