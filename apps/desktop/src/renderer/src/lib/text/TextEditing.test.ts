import { beforeEach, describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import { localPoint, scenePoint } from "@shift/editor/spaces";
import { clusterForCaret, glyphTextItem } from "@shift/editor/text";

describe("placed proof text editing", () => {
  let editor: TestEditor;
  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("text");
  });

  it("click creates an empty scene node with an editable caret", async () => {
    await editor.clickLocal(800, 0);
    const node = editor.scene.nodesOfKind("textRun")[0]!;
    expect(node.position).toEqual({ x: 800, y: 0 });
    expect(editor.text.run(node.runId)?.items).toEqual([]);
    expect(editor.textEditing.state).toMatchObject({ nodeId: node.id, anchor: null, focus: null });
    expect(editor.toolIf("text")?.state.type).toBe("editing");
    expect(editor.getPointerTarget(scenePoint(800, 0))).toMatchObject({ kind: "text", cluster: 0 });
  });

  it("inserts text and replays content and caret through undo and redo", async () => {
    await editor.clickLocal(800, 0);
    const node = editor.scene.nodesOfKind("textRun")[0]!;
    editor.textEditing.insert([glyphTextItem("A", 65)]);
    const item = editor.text.run(node.runId)!.items[0]!;
    expect(editor.textEditing.state?.focus).toBe(item.id);
    await editor.undo();
    expect(editor.text.run(node.runId)?.items).toEqual([]);
    expect(editor.textEditing.state?.focus).toBeNull();
    await editor.redo();
    expect(editor.text.run(node.runId)?.items[0]?.id).toBe(item.id);
    expect(editor.textEditing.state?.focus).toBe(item.id);
  });

  it("select-all includes linebreaks and undo restores the prior caret", async () => {
    await editor.clickLocal(800, 0);
    editor.textEditing.insertText("A\nA");
    const prior = editor.textEditing.state?.focus;
    editor.textEditing.selectAll();
    expect(editor.textEditing.selectedItems.map((item) => item.kind)).toEqual([
      "glyph",
      "linebreak",
      "glyph",
    ]);
    expect(editor.textEditing.state?.anchor).toBeNull();
    await editor.undo();
    expect(editor.textEditing.state?.focus).toBe(prior);
    expect(editor.textEditing.selectedItems).toEqual([]);
  });

  it("arrows and Backspace edit across a linebreak and undo restores it", async () => {
    await editor.clickLocal(800, 0);
    editor.textEditing.insertText("A\nA");
    const node = editor.scene.nodesOfKind("textRun")[0]!;
    editor.textEditing.move(-1, "character");
    expect(editor.textEditing.state?.focus).toBe(editor.text.run(node.runId)!.items[1]!.id);
    editor.textEditing.deleteBackward();
    expect(editor.text.run(node.runId)?.items.map((item) => item.kind)).toEqual(["glyph", "glyph"]);
    await editor.undo();
    expect(editor.text.run(node.runId)?.items.map((item) => item.kind)).toEqual([
      "glyph",
      "linebreak",
      "glyph",
    ]);
    expect(editor.textEditing.state?.focus).toBe(editor.text.run(node.runId)!.items[1]!.id);
  });

  it("vertical movement uses line clusters and Shift extends the selection", async () => {
    await editor.clickLocal(800, 0);
    editor.textEditing.insertText("A\nA");
    const node = editor.scene.nodesOfKind("textRun")[0]!;
    editor.textEditing.moveVertical(-1, true);
    expect(editor.textEditing.selectedItems.map((item) => item.kind)).toEqual([
      "linebreak",
      "glyph",
    ]);
    expect(editor.textEditing.state?.focus).toBe(editor.text.run(node.runId)!.items[0]!.id);
  });

  it("caret movement preserves layout identity while item edits rebuild it", async () => {
    await editor.clickLocal(800, 0);
    const node = editor.scene.nodesOfKind("textRun")[0]!;
    const layoutCell = editor.text.layoutCell(node.runId);
    const initial = layoutCell.peek();
    editor.textEditing.placeAtCluster(0);
    expect(layoutCell.peek()).toBe(initial);
    editor.textEditing.insert([glyphTextItem("A", 65)]);
    const populated = layoutCell.peek();
    expect(populated).not.toBe(initial);
    editor.textEditing.move(-1, "character");
    expect(layoutCell.peek()).toBe(populated);
  });

  it("a caret stays on its item when another item is inserted before it", async () => {
    await editor.clickLocal(800, 0);
    editor.textEditing.insert([glyphTextItem("A", 65), glyphTextItem("A", 65)]);
    const node = editor.scene.nodesOfKind("textRun")[0]!;
    const target = editor.text.run(node.runId)!.items[1]!.id;
    editor.textEditing.placeAtCluster(0);
    editor.textEditing.insert([glyphTextItem("A", 65)]);
    const items = editor.text.run(node.runId)!.items;
    expect(items[2]?.id).toBe(target);
    expect(clusterForCaret(items, target)).toBe(3);
  });

  it("Escape deletes an empty node; undo restores it without reopening editing", async () => {
    await editor.clickLocal(800, 0);
    const node = editor.scene.nodesOfKind("textRun")[0]!;
    editor.escape();
    expect(editor.scene.node(node.id)).toBeNull();
    expect(editor.text.run(node.runId)).toBeNull();
    expect(editor.toolIf("select")?.state.type).toBe("ready");
    await editor.undo();
    expect(editor.scene.node(node.id)).not.toBeNull();
    expect(editor.textEditing.state).toBeNull();
  });

  it("hit testing maps a placed and scaled glyph to its item cluster", async () => {
    await editor.clickLocal(800, 0);
    const original = editor.scene.nodesOfKind("textRun")[0]!;
    editor.textEditing.insert([glyphTextItem("A", 65)]);
    editor.scene.updateNode({
      id: original.id,
      size: editor.font.metricsCell.peek().unitsPerEm * 2,
    });
    const node = editor.scene.nodeOfKind(original.id, "textRun")!;
    const advance = editor.text.layoutCell(node.runId).peek()!.totalAdvance;
    const target = editor.nodeDefinition("textRun").hit(node, localPoint(advance * 0.75, 0));
    expect(target).toMatchObject({
      kind: "text",
      cluster: 1,
      itemId: editor.text.run(node.runId)!.items[0]!.id,
    });
    expect(
      editor.toSceneBounds(node, editor.nodeDefinition("textRun").bounds(node)!),
    ).toMatchObject({
      max: { x: expect.closeTo(800 + advance * 2) },
    });
    expect(editor.getPointerTarget(scenePoint(800 + advance * 1.5, 0))).toMatchObject({
      kind: "text",
      node: { id: node.id },
      cluster: 1,
    });
  });
});
