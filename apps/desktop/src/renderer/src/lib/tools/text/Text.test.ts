import { beforeEach, describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import { glyphTextItem } from "@shift/editor/text";

describe("Text tool creates and edits placed runs", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("text");
  });

  it("starts ready and returns to Select on Escape", () => {
    expect(editor.toolIf("text")?.state.type).toBe("ready");
    expect(editor.cursor).toBe("text");
    editor.escape();
    expect(editor.toolIf("select")?.state.type).toBe("ready");
  });

  it("creates a run and scene node in one undoable click", async () => {
    await editor.clickGlyphLocal(800, 0);
    const node = editor.scene.nodesOfKind("textRun")[0]!;
    expect(editor.text.run(node.runId)?.items).toEqual([]);
    expect(editor.textEditing.state?.nodeId).toBe(node.id);
    await editor.undo();
    expect(editor.scene.node(node.id)).toBeNull();
    expect(editor.text.run(node.runId)).toBeNull();
    await editor.redo();
    expect(editor.scene.node(node.id)).not.toBeNull();
    expect(editor.textEditing.state?.nodeId).toBe(node.id);
  });

  it("a second click on the empty caret does not create another run", async () => {
    await editor.clickGlyphLocal(800, 0);
    await editor.clickGlyphLocal(800, 0);
    expect(editor.scene.nodesOfKind("textRun")).toHaveLength(1);
  });

  it("clicking an existing text target places a caret instead of creating another run", async () => {
    await editor.clickGlyphLocal(800, 0);
    const node = editor.scene.nodesOfKind("textRun")[0]!;
    editor.textEditing.insert([glyphTextItem("A", 65)]);
    const advance = editor.text.layoutCell(node.runId).peek()!.totalAdvance;
    await editor.clickGlyphLocal(800 + advance * 0.25, 0);
    expect(editor.scene.nodesOfKind("textRun")).toHaveLength(1);
    expect(editor.textEditing.state?.focus).toBeNull();
  });

  it("dragging over text extends the item selection", async () => {
    await editor.clickGlyphLocal(800, 0);
    const node = editor.scene.nodesOfKind("textRun")[0]!;
    editor.textEditing.insert([glyphTextItem("A", 65), glyphTextItem("A", 65)]);
    const advance = editor.text.layoutCell(node.runId).peek()!.totalAdvance / 2;
    await editor.dragScene({
      down: { x: 800 + advance * 0.2, y: 0 },
      start: { x: 800 + advance * 1.2, y: 0 },
      end: { x: 800 + advance * 1.8, y: 0 },
    });
    expect(editor.textEditing.selectedItems).toHaveLength(2);
  });

  it("Escape discards an empty run and undo restores the node without focus", async () => {
    await editor.clickGlyphLocal(800, 0);
    const node = editor.scene.nodesOfKind("textRun")[0]!;
    editor.escape();
    expect(editor.scene.node(node.id)).toBeNull();
    await editor.undo();
    expect(editor.scene.node(node.id)).not.toBeNull();
    expect(editor.textEditing.state).toBeNull();
  });
});
