import { beforeEach, describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import { localPoint, scenePoint } from "@shift/editor/spaces";
import { characterTextItem, clusterForCaret } from "@shift/editor/text";
import type { GlyphNode, TextRunNode } from "@shift/editor/types";

describe("page run text editing", () => {
  let editor: TestEditor;
  let run: TextRunNode;
  let child: GlyphNode;

  const items = () => editor.text.run(run.runId)!.items;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    run = editor.textRun!;
    child = editor.runGlyph!;
    editor.selectTool("text");
  });

  it("entering Text mode puts the caret after the edited glyph and stops editing it", () => {
    expect(editor.textEditing.state).toMatchObject({ nodeId: run.id, focus: child.itemId });
    expect(editor.editing.nodeIds).toEqual([]);
    expect(editor.toolIf("text")?.state.type).toBe("editing");
  });

  it("leaving Text mode ends text editing and re-enters the glyph", () => {
    editor.escape();
    expect(editor.textEditing.state).toBeNull();
    expect(editor.editing.nodeIds).toEqual([child.id]);
    expect(editor.toolIf("select")?.state.type).toBe("ready");
  });

  it("returning to Text mode restores the caret and selection from the last visit", () => {
    editor.textEditing.insertText("AA");
    editor.textEditing.move(-1, "character", true);
    const { anchor, focus } = editor.textEditing.state!;
    editor.escape();
    editor.selectTool("text");
    expect(editor.textEditing.state).toMatchObject({ anchor, focus });
  });

  it("returning to Text mode puts the caret after the edited glyph when the old caret's item is gone", async () => {
    editor.textEditing.insert([characterTextItem(65)]);
    editor.escape();
    await editor.undo();
    editor.selectTool("text");
    expect(editor.textEditing.state).toMatchObject({ anchor: child.itemId, focus: child.itemId });
  });

  it("undo outside Text mode keeps the caret without showing it", async () => {
    editor.textEditing.insert([characterTextItem(65)]);
    editor.escape();
    await editor.undo();
    expect(editor.textEditing.state).toBeNull();
    editor.selectTool("text");
    expect(editor.textEditing.state).toMatchObject({ focus: child.itemId, active: true });
  });

  it("inserts text and replays content and caret through undo and redo", async () => {
    editor.textEditing.insert([characterTextItem(65)]);
    const item = items()[1]!;
    expect(editor.textEditing.state?.focus).toBe(item.id);
    await editor.undo();
    expect(items()).toHaveLength(1);
    expect(editor.textEditing.state?.focus).toBe(child.itemId);
    await editor.redo();
    expect(items()[1]?.id).toBe(item.id);
    expect(editor.textEditing.state?.focus).toBe(item.id);
  });

  it("typing before the edited glyph pushes it right", () => {
    const before = editor.toScene(child, localPoint(0, 0));
    editor.textEditing.placeAtCluster(0);
    editor.textEditing.insert([characterTextItem(65)]);
    const advance = editor.text.layoutCell(run.runId).peek()!.totalAdvance / 2;
    expect(editor.toScene(child, localPoint(0, 0))).toEqual({ x: before.x + advance, y: before.y });
  });

  it("deleting the edited glyph's item deletes its child; undo restores both", async () => {
    editor.textEditing.deleteBackward();
    expect(items()).toEqual([]);
    expect(editor.scene.node(child.id)).toBeNull();
    await editor.undo();
    expect(items()[0]?.id).toBe(child.itemId);
    expect(editor.scene.node(child.id)).not.toBeNull();
  });

  it("removing the edited glyph's item by any writer deletes its child in the same undo step", async () => {
    editor.escape();
    editor.history.capture("Clear run", () => editor.text.setItems(run.runId, []));
    expect(editor.scene.node(child.id)).toBeNull();
    await editor.undo();
    expect(items()[0]?.id).toBe(child.itemId);
    expect(editor.scene.node(child.id)).not.toBeNull();
  });

  it("leaving Text mode after deleting the edited glyph edits nothing", () => {
    editor.textEditing.deleteBackward();
    editor.escape();
    expect(editor.editing.nodeIds).toEqual([]);
    expect(editor.scene.nodesOfKind("textRun")).toHaveLength(1);
  });

  it("select-all includes linebreaks and undo restores the prior caret", async () => {
    editor.textEditing.insertText("\nA");
    const prior = editor.textEditing.state?.focus;
    editor.textEditing.selectAll();
    expect(editor.textEditing.selectedItems.map((item) => item.kind)).toEqual([
      "character",
      "linebreak",
      "character",
    ]);
    expect(editor.textEditing.state?.anchor).toBeNull();
    await editor.undo();
    expect(editor.textEditing.state?.focus).toBe(prior);
    expect(editor.textEditing.selectedItems).toEqual([]);
  });

  it("arrows and Backspace edit across a linebreak and undo restores it", async () => {
    editor.textEditing.insertText("\nA");
    editor.textEditing.move(-1, "character");
    expect(editor.textEditing.state?.focus).toBe(items()[1]!.id);
    editor.textEditing.deleteBackward();
    expect(items().map((item) => item.kind)).toEqual(["character", "character"]);
    await editor.undo();
    expect(items().map((item) => item.kind)).toEqual(["character", "linebreak", "character"]);
    expect(editor.textEditing.state?.focus).toBe(items()[1]!.id);
  });

  it("vertical movement uses line clusters and Shift extends the selection", () => {
    editor.textEditing.insertText("\nA");
    editor.textEditing.moveVertical(-1, true);
    expect(editor.textEditing.selectedItems.map((item) => item.kind)).toEqual([
      "linebreak",
      "character",
    ]);
    expect(editor.textEditing.state?.focus).toBe(items()[0]!.id);
  });

  it("caret movement preserves layout identity while item edits rebuild it", () => {
    const layoutCell = editor.text.layoutCell(run.runId);
    const initial = layoutCell.peek();
    editor.textEditing.placeAtCluster(0);
    expect(layoutCell.peek()).toBe(initial);
    editor.textEditing.insert([characterTextItem(65)]);
    const populated = layoutCell.peek();
    expect(populated).not.toBe(initial);
    editor.textEditing.move(-1, "character");
    expect(layoutCell.peek()).toBe(populated);
  });

  it("a caret stays on its item when another item is inserted before it", () => {
    editor.textEditing.insert([characterTextItem(65)]);
    const target = items()[1]!.id;
    editor.textEditing.placeAtCluster(0);
    editor.textEditing.insert([characterTextItem(65)]);
    expect(items()[2]?.id).toBe(target);
    expect(clusterForCaret(items(), target)).toBe(3);
  });

  it("caret placement maps a point in a scaled run to its cluster", () => {
    editor.textEditing.insert([characterTextItem(65)]);
    editor.scene.updateNode({
      id: run.id,
      size: editor.font.metricsCell.peek().unitsPerEm * 2,
    });
    const node = editor.scene.nodeOfKind(run.id, "textRun")!;
    const advance = editor.text.layoutCell(node.runId).peek()!.totalAdvance / 2;
    const definition = editor.nodeDefinition("textRun");

    expect(definition.caretAt(node, localPoint(advance * 1.75, 0))).toBe(2);
    expect(definition.caretAt(node, editor.toLocal(node, scenePoint(advance * 3.5, 0)))).toBe(2);
    expect(definition.caretAt(node, localPoint(advance * 10, 0))).toBeNull();
  });

  it("arrows step over a base and its combining mark as one character", () => {
    editor.textEditing.insertText("e\u0301x");
    const start = clusterForCaret(items(), editor.textEditing.state!.focus);

    editor.textEditing.move(-1, "character");
    editor.textEditing.move(-1, "character");

    expect(clusterForCaret(items(), editor.textEditing.state!.focus)).toBe(start - 3);
  });

  it("Backspace removes a combining mark alone and Delete removes the whole cluster", () => {
    editor.textEditing.insertText("e\u0301");
    editor.textEditing.deleteBackward();
    expect(items().at(-1)).toMatchObject({ kind: "character", codepoint: 0x65 });

    editor.textEditing.insertText("\u0301x");
    editor.textEditing.move(-1, "character");
    editor.textEditing.move(-1, "character");
    editor.textEditing.deleteForward();
    expect(items().at(-1)).toMatchObject({ kind: "character", codepoint: 0x78 });
    expect(items().some((item) => item.kind === "character" && item.codepoint === 0x65)).toBe(
      false,
    );
  });

  it("Option-arrows move to word edges, skipping spaces and punctuation", () => {
    editor.textEditing.insertText(" hello, world");
    const end = clusterForCaret(items(), editor.textEditing.state!.focus);

    editor.textEditing.move(-1, "word");
    expect(clusterForCaret(items(), editor.textEditing.state!.focus)).toBe(end - 5);
    editor.textEditing.move(-1, "word");
    expect(clusterForCaret(items(), editor.textEditing.state!.focus)).toBe(end - 12);
    editor.textEditing.move(1, "word");
    expect(clusterForCaret(items(), editor.textEditing.state!.focus)).toBe(end - 7);
  });
});
