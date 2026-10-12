import { beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { GlyphName, RunId } from "@shift/types";
import { clusterForCaret, lineBreakTextItem } from "@shift/editor/text";
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
        .map((mark) => [mark.origin.x - (base?.origin.x ?? 0), mark.origin.y])
        .sort((a, b) => a[1]! - b[1]!);
    };

    await expect.poll(raised).toEqual([
      [350, 100],
      [350, 300],
    ]);
    expect(editor.text.layoutCell(runId).peek()!.totalAdvance).toBe(500);
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

describe("carets in shaped text", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
  });

  /** Three joined behs: init (850–1250), medi (450–850), fina (0–450). */
  const threeBehs = async () => {
    const runId = editor.text.createRun(editor.text.itemsFromText("\u0628\u0628\u0628")).id;
    await expect.poll(() => editor.text.layoutCell(runId).peek()?.totalAdvance).toBe(1250);
    return editor.text.layoutCell(runId).peek()!;
  };

  it("stands on the right edge before right-to-left text and the left edge after it", async () => {
    const layout = await threeBehs();

    expect([0, 1, 2, 3].map((cluster) => layout.caretPosition(cluster).x)).toEqual([
      1250, 850, 450, 0,
    ]);
  });

  it("lands on the nearest character boundary when right-to-left text is clicked", async () => {
    const layout = await threeBehs();

    expect(layout.caretAtPoint({ x: 1200, y: 0 })).toBe(0);
    expect(layout.caretAtPoint({ x: 100, y: 0 })).toBe(3);
  });

  it("splits a ligature between the characters it joins", async () => {
    const runId = editor.text.createRun(editor.text.itemsFromText("fi")).id;
    await expect.poll(() => editor.text.layoutCell(runId).peek()?.totalAdvance).toBe(550);

    expect(editor.text.layoutCell(runId).peek()!.caretPosition(1).x).toBe(275);
  });

  it("arrow keys follow the screen in right-to-left text", async () => {
    editor.selectTool("text");
    editor.textEditing.selectAll();
    editor.textEditing.insertText("ببب");
    const runId = editor.textRun!.runId;
    await expect.poll(() => editor.text.layoutCell(runId).peek()?.totalAdvance).toBe(1250);
    const caret = () =>
      clusterForCaret(editor.text.run(runId)!.items, editor.textEditing.state!.focus);

    editor.textEditing.move(1, "character");
    expect(caret()).toBe(2);
    editor.textEditing.move(-1, "character");
    editor.textEditing.move(-1, "character");
    expect(caret()).toBe(3);
  });
});

describe("editing shaped text keeps untouched lines shaped", () => {
  it("pressing Enter leaves the line above joined while the new line waits", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    editor.selectTool("text");
    editor.textEditing.selectAll();
    editor.textEditing.insertText("\u0628\u0628");
    const runId = editor.textRun!.runId;
    const firstLine = () =>
      editor.text
        .layoutCell(runId)
        .peek()!
        .lines[0]!.runs.flatMap((run) => run.glyphs.map((glyph) => glyph.glyphName));
    await expect.poll(firstLine).toEqual(["beh-ar.fina", "beh-ar.init"]);

    editor.textEditing.insert([lineBreakTextItem()]);

    expect(firstLine()).toEqual(["beh-ar.fina", "beh-ar.init"]);
  });
});

describe("turning shaping off lays a run out as typed", () => {
  it("shows the typed glyphs at once, and undo shapes the run again", async () => {
    const editor = new TestEditor();
    await editor.openSession(SHAPING_TEST, "f");
    const runId = editor.text.createRun(editor.text.itemsFromText("fi")).id;
    const names = () =>
      editor.text
        .layoutCell(runId)
        .peek()!
        .placedGlyphs.map((placed) => placed.glyph.glyphName);
    await expect.poll(names).toEqual(["f_i"]);

    editor.history.capture("Turn shaping off", () => editor.text.setShaping(runId, false));
    expect(names()).toEqual(["f", "i"]);

    await editor.undo();
    await expect.poll(names).toEqual(["f_i"]);
  });
});
