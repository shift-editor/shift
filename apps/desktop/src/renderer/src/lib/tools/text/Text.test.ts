import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GlyphName } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";
import { Point } from "@shift/glyph-state";
import { glyphTextItem } from "@shift/editor/text";

describe("Text tool edits the page run", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("text");
  });

  const run = () => editor.textRun!;
  const glyphAdvance = () => editor.text.layoutCell(run().runId).peek()!.totalAdvance;

  it("starts editing and returns to Select on Escape", () => {
    expect(editor.toolIf("text")?.state.type).toBe("editing");
    expect(editor.cursor).toBe("text");
    editor.escape();
    expect(editor.toolIf("select")?.state.type).toBe("ready");
  });

  it("clicking empty canvas leaves the run and caret alone", async () => {
    const before = editor.textEditing.state;
    await editor.clickLocal(5000, 0);
    expect(editor.scene.nodesOfKind("textRun")).toHaveLength(1);
    expect(editor.text.run(run().runId)?.items).toHaveLength(1);
    expect(editor.textEditing.state).toEqual(before);
  });

  it("clicking a glyph in the run places the caret", async () => {
    await editor.clickLocal(glyphAdvance() * 0.25, 0);
    expect(editor.textEditing.state?.focus).toBeNull();
  });

  it("dragging over text extends the item selection", async () => {
    editor.textEditing.insert([glyphTextItem("A", 65)]);
    const advance = glyphAdvance() / 2;
    await editor.dragScene({
      down: { x: advance * 0.2, y: 0 },
      start: { x: advance * 1.2, y: 0 },
      end: { x: advance * 1.8, y: 0 },
    });
    expect(editor.textEditing.selectedItems).toHaveLength(2);
  });
});

describe("typing a glyph not yet loaded this session", () => {
  const outputRoots: string[] = [];

  afterEach(() => {
    for (const root of outputRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /** Saves a font whose `B` glyph advances 600, then reopens it on `A` without loading `B`. */
  async function reopenedWithUnloadedB(): Promise<TestEditor> {
    const outputRoot = mkdtempSync(join(tmpdir(), "shift-unloaded-text-glyph-"));
    outputRoots.push(outputRoot);
    const savePath = join(outputRoot, "Text.shift");

    const setup = new TestEditor();
    await setup.startSession("A", 65);
    await setup.addGlyph("B", 66);
    const bRecord = setup.font.recordForName("B" as GlyphName)!;
    const b = await setup.font.loadGlyph(bRecord.id);
    b.layerForSource(setup.font.defaultSource.id)!.setXAdvance(600);
    await setup.saveAs(savePath);
    await setup.closeSession();

    const editor = new TestEditor();
    await editor.openSession(savePath, "A");
    return editor;
  }

  it("lays the glyph out at its advance once its model loads", async () => {
    const editor = await reopenedWithUnloadedB();
    const bId = editor.font.recordForName("B" as GlyphName)!.id;
    expect(editor.glyphForId(bId)).toBeNull();

    editor.selectTool("text");
    const node = editor.textRun!;
    const layout = editor.text.layoutCell(node.runId);
    const before = layout.peek()!.totalAdvance;
    editor.textEditing.insert([glyphTextItem("B", 66)]);
    expect(layout.peek()?.totalAdvance).toBe(before);

    await editor.font.loadGlyph(bId);

    expect(layout.peek()?.totalAdvance).toBe(before + 600);
  });
});

describe("Select over the page run", () => {
  let editor: TestEditor;

  // A carries a closed square from 100 to 300; the run's second item is another A.
  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    for (const [x, y] of [
      [100, 100],
      [300, 100],
      [300, 300],
      [100, 300],
      [100, 100],
    ] as const) {
      await editor.clickLocal(x, y);
    }
    editor.selectTool("text");
    editor.textEditing.insert([glyphTextItem("A", 65)]);
    editor.escape();
  });

  const run = () => editor.textRun!;
  const secondItem = () => editor.text.run(run().runId)!.items[1]!;
  const secondOrigin = () => editor.text.layoutCell(run().runId).peek()!.totalAdvance / 2;
  const hoverLocal = (x: number, y: number) => {
    const screen = editor.localToScreen({ x, y });
    editor.pointerMove(screen.x, screen.y);
  };

  it("hovering inside a run glyph's outline hovers its item", () => {
    hoverLocal(secondOrigin() + 200, 200);
    expect(editor.hover.id).toBe(secondItem().id);
  });

  it("hovering a run glyph's empty space outside its outline hovers nothing", () => {
    hoverLocal(secondOrigin() + 50, 200);
    expect(editor.hover.id).toBeNull();
  });

  it("the edited glyph's own item never hovers as text", () => {
    hoverLocal(200, 200);
    expect(editor.hover.id).toBeNull();
  });

  it("the selection box follows the edited glyph when an advance before it changes", async () => {
    editor.selectTool("text");
    editor.textEditing.placeAtCluster(0);
    editor.textEditing.insert([glyphTextItem("A", 65)]);
    editor.escape();
    editor.selectAll();
    const bounds = editor.selectionSceneBoundsCell;
    const before = bounds.value!.min.x;

    const layer = editor.requireGlyphLayer();
    layer.setXAdvance(layer.xAdvance + 100);
    await editor.settle();

    expect(bounds.value!.min.x).toBeCloseTo(before + 100);
  });

  it("clicking a run glyph selects its item", async () => {
    const screen = editor.localToScreen({ x: secondOrigin() + 200, y: 200 });
    await editor.click(screen.x, screen.y);
    expect(editor.selection.ids).toEqual([secondItem().id]);
    expect(editor.object(secondItem().id)).toMatchObject({
      kind: "textItem",
      node: { id: run().id },
      glyphId: editor.runGlyph!.glyphId,
    });
  });

  it("double-clicking a run glyph edits it in place as one undo step", async () => {
    const previous = editor.runGlyph!;
    const second = secondItem();
    const screen = editor.localToScreen({ x: secondOrigin() + 200, y: 200 });
    const pan = editor.camera.pan;

    await editor.click(screen.x, screen.y);
    await editor.click(screen.x, screen.y);

    const child = editor.runGlyph!;
    expect(child).toMatchObject({ itemId: second.id, parentId: run().id });
    expect(editor.scene.node(previous.id)).toBeNull();
    expect(editor.editing.nodeIds).toEqual([child.id]);
    expect(editor.camera.pan).toEqual(pan);

    await editor.undo();
    expect(editor.runGlyph?.id).toBe(previous.id);
    expect(editor.editing.nodeIds).toEqual([previous.id]);
  });

  it("Pen clicks over a run glyph still draw into the edited glyph", async () => {
    const layer = editor.requireGlyphLayer();
    const before = layer.contours.length;
    editor.selectTool("pen");
    await editor.clickLocal(secondOrigin() + 200, 200);
    expect(layer.contours.length).toBe(before + 1);
  });
});

describe("double-clicking a component", () => {
  it("opens its base glyph next to the edited glyph as one undo step", async () => {
    const editor = new TestEditor();
    await editor.startSession();
    await editor.addGlyph("B", 66);
    const bRecord = editor.font.recordForName("B" as GlyphName)!;
    const bLayer = (await editor.font.loadGlyph(bRecord.id)).layerForSource(
      editor.font.defaultSource.id,
    )!;
    const contourId = bLayer.addContour();
    for (const [x, y] of [
      [100, 100],
      [300, 100],
      [300, 300],
      [100, 300],
    ] as const) {
      bLayer.addPoint(contourId, Point.onCurve({ x, y }));
    }
    bLayer.closeContour(contourId);
    editor.requireGlyphLayer().addComponent(bRecord.id);
    await editor.settle();

    const run = editor.textRun!;
    const previous = editor.runGlyph!;
    const screen = editor.localToScreen({ x: 200, y: 200 });
    await editor.click(screen.x, screen.y);
    await editor.click(screen.x, screen.y);

    const items = editor.text.run(run.runId)!.items;
    expect(items.map((item) => item.kind === "glyph" && item.glyphName)).toEqual(["A", "B"]);
    const child = editor.runGlyph!;
    expect(child).toMatchObject({ glyphId: bRecord.id, itemId: items[1]!.id });
    expect(editor.editing.nodeIds).toEqual([child.id]);

    await editor.undo();
    expect(editor.text.run(run.runId)!.items).toHaveLength(1);
    expect(editor.runGlyph?.id).toBe(previous.id);
  });
});
