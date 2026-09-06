import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";

describe("editor history", () => {
  let editor: TestEditor;
  let firstId: PointId;
  let secondId: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    const pointIds = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ]);
    if (!pointIds[0] || !pointIds[1]) throw new Error("Expected two points");
    [firstId, secondId] = pointIds;
    editor.selectTool("select");
    editor.history.reset();
  });

  it("does not change document state for selection-only history", async () => {
    const before = await editor.font.editCoordinator.state();

    editor.selection.select([firstId]);
    await editor.undo();
    await editor.redo();

    expect(await editor.font.editCoordinator.state()).toEqual(before);
    expect(editor.selection.ids).toEqual([firstId]);
  });

  it("undoes and redoes Shift-click selection as individual actions", async () => {
    await editor.clickGlyphLocal(100, 100);
    await editor.clickGlyphLocal(200, 200, { shiftKey: true });
    expect(editor.selection.ids).toEqual([firstId, secondId]);

    await editor.undo();
    expect(editor.selection.ids).toEqual([firstId]);

    await editor.redo();
    expect(editor.selection.ids).toEqual([firstId, secondId]);
  });

  it("coalesces a marquee gesture into one selection action", async () => {
    await editor.dragScene({
      down: { x: 80, y: 80 },
      start: { x: 84, y: 80 },
      end: { x: 130, y: 130 },
    });
    expect(editor.selection.ids).toEqual([firstId]);

    await editor.undo();
    expect(editor.selection.ids).toEqual([]);

    await editor.redo();
    expect(editor.selection.ids).toEqual([firstId]);
  });

  it("compounds selecting and moving an unselected point", async () => {
    const before = editor.pointPosition(firstId);
    await editor.dragScene({
      down: before,
      start: { x: before.x + 4, y: before.y },
      end: { x: before.x + 40, y: before.y + 30 },
    });
    expect(editor.selection.ids).toEqual([firstId]);
    expect(editor.pointPosition(firstId)).toEqual({ x: before.x + 40, y: before.y + 30 });

    await editor.undo();
    expect(editor.selection.ids).toEqual([]);
    expect(editor.pointPosition(firstId)).toEqual(before);

    await editor.redo();
    expect(editor.selection.ids).toEqual([firstId]);
    expect(editor.pointPosition(firstId)).toEqual({ x: before.x + 40, y: before.y + 30 });
  });

  it("compounds Delete with clearing and restoring its selection", async () => {
    editor.selection.select([secondId]);

    await editor.deleteSelection();
    expect(editor.requireGlyphLayer().point(secondId)).toBeNull();
    expect(editor.selection.ids).toEqual([]);

    await editor.undo();
    expect(editor.requireGlyphLayer().point(secondId)).not.toBeNull();
    expect(editor.selection.ids).toEqual([secondId]);

    await editor.redo();
    expect(editor.requireGlyphLayer().point(secondId)).toBeNull();
    expect(editor.selection.ids).toEqual([]);
  });

  it("discards selection changes from a canceled marquee", async () => {
    editor.selection.select([secondId]);
    const down = editor.projectSceneToScreen({ x: 80, y: 80 });
    const end = editor.projectSceneToScreen({ x: 130, y: 130 });

    editor.pointerDown(down.x, down.y);
    editor.pointerMove(end.x, end.y);
    editor.toolManager.cancelPointerGesture();
    expect(editor.selection.ids).toEqual([secondId]);

    await editor.undo();
    expect(editor.selection.ids).toEqual([]);
  });

  it("discards the renderer redo branch after a new selection action", async () => {
    await editor.clickGlyphLocal(100, 100);
    await editor.clickGlyphLocal(200, 200, { shiftKey: true });
    await editor.undo();
    expect(editor.selection.ids).toEqual([firstId]);

    await editor.click(9999, 9999);
    expect(editor.selection.ids).toEqual([]);

    await editor.redo();
    expect(editor.selection.ids).toEqual([]);
  });

  it("discards the document redo branch after a new selection-only action", async () => {
    editor.selectTool("pen");
    await editor.clickGlyphLocal(300, 300);
    expect(editor.pointCount).toBe(3);

    await editor.undo();
    expect(editor.pointCount).toBe(2);
    expect(editor.selection.ids).toEqual([]);

    const node = editor.glyphNode;
    if (!node) throw new Error("Expected glyph node");
    editor.selection.select([node.id]);
    await editor.redo();

    expect(editor.pointCount).toBe(2);
    expect(editor.selection.ids).toEqual([node.id]);
  });
});
