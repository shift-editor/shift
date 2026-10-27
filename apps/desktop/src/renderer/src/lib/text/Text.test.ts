import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { localPoint, scenePoint } from "@shift/editor/spaces";
import { effect } from "@shift/editor/signals";
import { characterTextItem, glyphTextItem, type TextItem } from "@shift/editor/text";
import { trackRunLayouts } from "@shift/editor/tools";
import type { GlyphName, RunId, ShapeUnit } from "@shift/types";
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

  it("redraw an overlay tracking every run's layout when the active source changes", async () => {
    const editor = await new TestEditor().openSession(
      resolve(FONTS, "mutatorsans-variable/MutatorSans.designspace"),
      "T",
    );
    editor.selectTool("text");
    editor.textEditing.insert([characterTextItem(65)]);
    editor.escape();
    await editor.settle();
    const placed = () => editor.text.layoutCell(editor.textRun!.runId).peek()!.placedGlyphs;
    const drawn: number[] = [];
    const overlay = effect(() => {
      trackRunLayouts(editor);
      drawn.push(placed()[1]!.left);
    });

    editor.selectSource(editor.font.sources.find((source) => source.name === "BoldWide")!.id);
    overlay.dispose();

    expect(drawn).toHaveLength(2);
    expect(drawn[1]).not.toBe(drawn[0]);
    await editor.close();
  });
});

describe("TextRunNodeDefinition", () => {
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
    const advance = editor.text.layoutCell(node.runId).peek()!.totalAdvance / 2;
    const definition = editor.nodeDefinition("textRun");

    expect(definition.caretAt(node, localPoint(advance * 1.75, 0))).toBe(2);
    expect(definition.caretAt(node, editor.toLocal(node, scenePoint(advance * 3.5, 0)))).toBe(2);
    expect(definition.caretAt(node, localPoint(advance * 10, 0))).toBeNull();
    await editor.close();
  });
});

/** The unit the workspace shapes for an item; none for a line break. */
function shapeUnit(item: TextItem): ShapeUnit[] {
  if (item.kind === "character") return [{ codepoint: item.codepoint }];
  if (item.kind === "glyph") return [{ glyphId: item.glyphId }];

  return [];
}

/**
 * Subject test of the editor's `TextShaper` against the workspace's shaper:
 * the two must give the same glyphs for the same text.
 */
describe("TextShaper", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(resolve(FONTS, "ShapingTest.ufo"), "f");
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
});
