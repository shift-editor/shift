import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Mat } from "@shift/geo";
import { Point } from "@shift/glyph-state";
import { localPoint, scenePoint } from "@shift/editor/spaces";
import { effect } from "@shift/editor/signals";
import { characterTextItem, glyphTextItem } from "@shift/editor/text";
import { trackRunLayouts } from "@shift/editor/tools";
import type { GlyphName } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";

const FONTS = resolve(process.cwd(), "../../fixtures/fonts");

/**
 * Subject tests of `Text`'s layout cells and the text run node: when a layout
 * is rebuilt, what keeps a run's edited child in step with its items, and
 * caret hits in a scaled run, which no user can make yet.
 */
describe("Text layout cells", () => {
  it("keep a run's layout while a point moves, since only anchors place marks", async () => {
    const editor = await new TestEditor().openSession(
      resolve(FONTS, "AnchorPropagation.glyphs"),
      "a",
    );
    for (const record of editor.font.glyphRecords()) await editor.font.loadGlyph(record.id);
    const id = (name: string) => editor.font.recordForName(name as GlyphName)!.id;
    const layer = editor.requireGlyphLayer();
    const contourId = layer.addContour();
    const pointId = layer.addOnCurvePoint(contourId, { x: 0, y: 0 });
    await editor.settle();
    const run = editor.text.createRun([glyphTextItem(id("a")), glyphTextItem(id("acutecomb"))]);
    const layout = editor.text.layoutCell(run.id);
    // Subscribed the way the canvas holds a run's layout.
    const subscription = effect(() => void layout.value);
    await editor.text.settled();
    const before = layout.peek();

    layer.previewPositionPatch([{ kind: "point", id: pointId, x: 40, y: 0 }]);
    subscription.dispose();

    expect(layout.peek()).toBe(before);
    await editor.close();
  });

  it("keep a run's layout while the caret moves, and rebuild it when items change", async () => {
    const editor = await new TestEditor().startSession();
    editor.selectTool("text");
    const layoutCell = editor.text.layoutCell(editor.textRun!.runId);
    const initial = layoutCell.peek();

    editor.textEditing.placeAtCluster(0);
    expect(layoutCell.peek()).toBe(initial);
    editor.textEditing.insert([characterTextItem(65)]);
    const populated = layoutCell.peek();
    expect(populated).not.toBe(initial);
    editor.textEditing.move(-1, "character");
    expect(layoutCell.peek()).toBe(populated);
    await editor.close();
  });

  it("read a run's current layout without subscribing", async () => {
    const editor = await new TestEditor().startSession();
    editor.selectTool("text");
    const runId = editor.textRun!.runId;

    const before = editor.text.layout(runId)!;
    expect(before).toBe(editor.text.layoutCell(runId).peek());

    editor.textEditing.placeAtCluster(0);
    editor.textEditing.insert([characterTextItem(65)]);
    expect(editor.text.layout(runId)!.placedGlyphs).toHaveLength(before.placedGlyphs.length + 1);
    await editor.close();
  });

  it("redraw an overlay tracking every run's layout when the active source changes", async () => {
    const editor = await new TestEditor().openSession(
      resolve(FONTS, "mutatorsans-variable/MutatorSans.designspace"),
      "T",
    );
    editor.selectTool("text");
    editor.textEditing.insert([characterTextItem(65)]);
    editor.escape();
    await editor.settle();
    const placed = () => editor.text.layout(editor.textRun!.runId)!.placedGlyphs;
    const drawn: number[] = [];
    const overlay = effect(() => {
      trackRunLayouts(editor);
      drawn.push(placed()[1]!.left);
    });

    editor.selectSource(editor.font.sourceNamed("BoldWide")!.id);
    overlay.dispose();

    expect(drawn).toHaveLength(2);
    expect(drawn[1]).not.toBe(drawn[0]);
    await editor.close();
  });
});

describe("TextRunNodeDefinition", () => {
  // No resize handle shows for several run glyphs selected at the run level, so
  // this drives the run's transform target directly.
  it("scales each glyph from its own edge, and a component follows its scaled base once", async () => {
    const editor = await new TestEditor().startSession();
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
    bLayer.setXAdvance(500);
    const aLayer = editor.requireGlyphLayer();
    aLayer.addComponent(bRecord.id);
    editor.selectTool("text");
    editor.textEditing.insertText("B");
    editor.escape();
    editor.selection.clear();
    editor.escape();
    await editor.settle();

    editor.selectAll();
    const edit = editor.transformTarget()!.begin("scale");
    edit.preview(({ bounds }) =>
      Mat.Compose(
        Mat.Translate(bounds.left, bounds.bottom),
        Mat.Compose(Mat.Scale(2, 2), Mat.Translate(-bounds.left, -bounds.bottom)),
      ),
    );
    edit.commit();
    await editor.settle();

    expect(bLayer.sidebearings).toEqual({ lsb: 100, rsb: 200 });
    expect(bLayer.xAdvance).toBe(700);
    expect(aLayer.components[0]?.matrix).toMatchObject({ a: 1, d: 1, e: 0, f: 0 });
    await editor.close();
  });

  it("deletes the edited child when any writer removes its item, in the same undo step", async () => {
    const editor = await new TestEditor().startSession();
    const run = editor.textRun!;
    const child = editor.runGlyph!;

    editor.history.capture("Clear run", () => editor.text.setItems(run.runId, []));
    expect(editor.scene.node(child.id)).toBeNull();

    await editor.undo();
    expect(editor.text.run(run.runId)!.items[0]?.id).toBe(child.itemId);
    expect(editor.scene.node(child.id)).not.toBeNull();
    await editor.close();
  });

  it("maps a point in a scaled run to its caret position", async () => {
    const editor = await new TestEditor().startSession();
    const run = editor.textRun!;
    editor.selectTool("text");
    editor.textEditing.insert([characterTextItem(65)]);
    editor.scene.updateNode({ id: run.id, size: editor.font.metricsCell.peek().unitsPerEm * 2 });
    const node = editor.scene.nodeOfKind(run.id, "textRun")!;
    const advance = editor.text.layout(node.runId)!.totalAdvance / 2;
    const definition = editor.nodeDefinition("textRun");

    expect(definition.caretAt(node, localPoint(advance * 1.75, 0))).toBe(2);
    expect(definition.caretAt(node, editor.toLocal(node, scenePoint(advance * 3.5, 0)))).toBe(2);
    expect(definition.caretAt(node, localPoint(advance * 10, 0))).toBeNull();
    await editor.close();
  });
});

describe("TextEditing", () => {
  it("shows the caret, its selection and where it draws only in the edited node", async () => {
    const editor = await new TestEditor().startSession();
    editor.selectTool("text");
    const node = editor.textRun!;
    editor.textEditing.placeAtCluster(0);
    editor.textEditing.insert([characterTextItem(65), characterTextItem(66)]);
    editor.textEditing.move(-1, "character", true);
    const layout = editor.text.layout(node.runId)!;

    expect(editor.textEditing.caretIn(node.id)).toEqual({
      cluster: 1,
      selection: { start: 1, end: 2 },
      position: layout.caretAt(1).position(),
    });

    editor.escape();
    expect(editor.textEditing.caretIn(node.id)).toBeNull();
    await editor.close();
  });
});
