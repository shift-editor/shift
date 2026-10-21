import { beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { byAxis } from "@shift/geo";
import type { GlyphName, RunId, ShapeUnit } from "@shift/types";
import type { TextItem } from "@shift/editor/text";
import { TestEditor } from "@/testing/TestEditor";

const SHAPING_TEST = resolve(process.cwd(), "../../fixtures/fonts/ShapingTest.ufo");

describe("proof text is shaped with the font's feature code", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
  });

  const run = (text: string) => editor.text.createRun(editor.text.itemsFromText(text)).id;
  const placed = (runId: RunId) => editor.text.layoutCell(runId).peek()?.placedGlyphs ?? [];
  const names = (runId: RunId) => placed(runId).map((glyph) => glyph.glyph.glyphName);

  it("forms a ligature that covers both typed characters", async () => {
    const runId = run("fi");

    await expect.poll(() => names(runId)).toEqual(["f_i"]);
    const items = editor.text.run(runId)!.items.map((item) => item.id);
    expect(placed(runId)[0]!.glyph.sourceItemIds).toEqual(items);
  });

  it("joins Arabic into positional forms laid out right to left", async () => {
    const runId = run("ببب");

    await expect.poll(() => names(runId)).toEqual(["beh-ar.fina", "beh-ar.medi", "beh-ar.init"]);
    const lefts = placed(runId).map((glyph) => glyph.left);
    expect(lefts).toEqual([0, 450, 850]);
  });

  it("places a mark on its base's anchor and a second mark on the first", async () => {
    const runId = run("بَّ");

    const raised = () => {
      const base = placed(runId).find((glyph) => glyph.glyph.glyphName === "beh-ar");
      const marks = placed(runId).filter((glyph) => glyph !== base);
      return marks
        .map((mark) => ({ x: mark.origin.x - (base?.origin.x ?? 0), y: mark.origin.y }))
        .sort(byAxis("y"));
    };

    await expect.poll(raised).toEqual([
      { x: 350, y: 100 },
      { x: 350, y: 300 },
    ]);
    expect(editor.text.layoutCell(runId).peek()!.totalAdvance).toBe(500);
  });
});

/** The unit the workspace shapes for an item; none for a line break. */
function shapeUnit(item: TextItem): ShapeUnit[] {
  if (item.kind === "character") return [{ codepoint: item.codepoint }];
  if (item.kind === "glyph") return [{ glyphId: item.glyphId }];

  return [];
}

describe("proof text shapes in the editor, as the workspace shapes it", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
  });

  const run = (text: string) => editor.text.createRun(editor.text.itemsFromText(text)).id;
  const placed = (runId: RunId) => editor.text.layoutCell(runId).peek()?.placedGlyphs ?? [];
  const glyphIds = (runId: RunId) => placed(runId).map((glyph) => glyph.glyph.glyphId);

  /** The workspace's shaping of the same run, as glyph ids in the order a single-direction line shows them. */
  const workspaceGlyphIds = async (runId: RunId) => {
    const units = editor.text.run(runId)!.items.flatMap(shapeUnit);
    const [runs] = await editor.font.shapeParagraphs([{ units, location: { values: {} } }]);
    return runs!.flatMap((shaped) => shaped.glyphs.map((glyph) => glyph.glyphId ?? null));
  };

  it.each([
    ["a ligature", "fi"],
    ["ligatures among spaces", "fi fifi f"],
    ["Arabic joining forms", "ببب بب"],
    ["marks on a base", "بَّ"],
  ])("shapes %s to the glyphs the workspace's shaper gives", async (_case, text) => {
    const runId = run(text);
    const expected = await workspaceGlyphIds(runId);

    await expect.poll(() => glyphIds(runId)).toEqual(expected);
  });

  it("shapes new text in the same tick once the shaper is ready", async () => {
    const ready = run("fi");
    await expect.poll(() => placed(ready).map((glyph) => glyph.glyph.glyphName)).toEqual(["f_i"]);

    const runId = run("fifi");

    expect(placed(runId).map((glyph) => glyph.glyph.glyphName)).toEqual(["f_i", "f_i"]);
  });
});

describe("double-clicking a character the font decomposes", () => {
  let editor: TestEditor;
  let runId: RunId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    runId = editor.textRun!.runId;
    const [first] = editor.text.run(runId)!.items;
    editor.text.insertAfter(runId, first!.id, editor.text.itemsFromText("\u0646"));
    await expect.poll(() => placedNamed("dotabove-ar")).not.toBeNull();
  });

  const placedNamed = (name: string) =>
    editor.text
      .layoutCell(runId)
      .peek()
      ?.placedGlyphs.find((placed) => placed.glyph.glyphName === name) ?? null;
  const doubleClickRun = async (x: number, y: number) => {
    const screen = editor.localToScreen({ x, y });
    await editor.click(screen.x, screen.y);
    await editor.click(screen.x, screen.y);
  };
  const glyphId = (name: string) => editor.font.recordForName(name as GlyphName)!.id;

  it("edits the body that was clicked and keeps drawing the dot", async () => {
    const body = placedNamed("noonDotless-ar")!;
    await doubleClickRun(body.origin.x + 250, 250);

    expect(editor.runGlyph?.glyphId).toBe(glyphId("noonDotless-ar"));
    // The body is now the open glyph, so points are measured from its origin.
    const dot = placedNamed("dotabove-ar")!;
    const screen = editor.localToScreen({
      x: dot.origin.x - body.origin.x - 100,
      y: dot.origin.y - body.origin.y + 550,
    });
    editor.pointerMove(screen.x, screen.y);
    expect(editor.hover.id).toBe(dot.glyph.sourceItemIds[0]);
  });

  it("edits the dot when the dot is clicked", async () => {
    const dot = placedNamed("dotabove-ar")!;
    await doubleClickRun(dot.origin.x - 100, dot.origin.y + 550);

    expect(editor.runGlyph?.glyphId).toBe(glyphId("dotabove-ar"));
  });
});
