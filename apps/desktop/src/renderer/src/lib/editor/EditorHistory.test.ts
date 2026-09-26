import { beforeEach, describe, expect, it } from "vitest";
import { mintGlyphId, type GlyphName, type PointId, type Unicode } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";

describe("editor actions share one undo timeline", () => {
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
    editor.selection.clear();
  });

  it("changes no document state when undoing and redoing a selection", async () => {
    const before = await editor.font.editCoordinator.state();

    await editor.clickGlyphLocal(100, 100);
    await editor.undo();
    await editor.redo();

    expect(await editor.font.editCoordinator.state()).toEqual(before);
    expect(editor.selection.ids).toEqual([firstId]);
  });

  it("captures a synchronous action and returns its result", async () => {
    const result = editor.history.capture("Select", () => {
      editor.selection.select([firstId]);
      return firstId;
    });

    expect(result).toBe(firstId);
    await editor.undo();
    expect(editor.selection.ids).toEqual([]);
  });

  it("cancels a synchronous action that throws", () => {
    expect(() =>
      editor.history.capture("Rejected selection", () => {
        editor.selection.select([firstId]);
        throw new Error("selection failed");
      }),
    ).toThrow("selection failed");

    expect(editor.selection.ids).toEqual([]);
    expect(editor.history.capturing).toBe(false);
  });

  it("captures an asynchronous action and returns its result", async () => {
    const result = await editor.history.captureAsync("Select", async () => {
      await Promise.resolve();
      editor.selection.select([firstId]);
      return firstId;
    });

    expect(result).toBe(firstId);
    await editor.undo();
    expect(editor.selection.ids).toEqual([]);
  });

  it("cancels an asynchronous action that rejects", async () => {
    const action = editor.history.captureAsync("Rejected selection", async () => {
      editor.selection.select([firstId]);
      await Promise.resolve();
      throw new Error("selection failed");
    });

    await expect(action).rejects.toThrow("selection failed");
    expect(editor.selection.ids).toEqual([]);
    expect(editor.history.capturing).toBe(false);
  });

  it("undoes Shift-click selection independently", async () => {
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

  it("preserves the starting selection for a Shift-marquee", async () => {
    editor.selection.select([secondId]);

    await editor.dragScene({
      down: { x: 60, y: 60 },
      start: { x: 70, y: 60 },
      end: { x: 130, y: 130 },
      options: { shiftKey: true },
    });
    expect(editor.selection.ids).toEqual([secondId, firstId]);

    await editor.undo();
    expect(editor.selection.ids).toEqual([secondId]);
  });

  it("preserves selection when a Shift-marquee contains no points", async () => {
    editor.selection.select([secondId]);

    await editor.dragScene({
      down: { x: 60, y: 60 },
      start: { x: 70, y: 60 },
      end: { x: 80, y: 80 },
      options: { shiftKey: true },
    });

    expect(editor.selection.ids).toEqual([secondId]);
  });

  it("drops only newly brushed points when a Shift-marquee shrinks", () => {
    editor.selection.select([secondId]);
    const down = editor.projectSceneToScreen({ x: 60, y: 60 });
    const expanded = editor.projectSceneToScreen({ x: 130, y: 130 });
    const shrunk = editor.projectSceneToScreen({ x: 80, y: 80 });

    editor.pointerDown(down.x, down.y, { shiftKey: true });
    editor.pointerMove(expanded.x, expanded.y, { shiftKey: true });
    expect(editor.selection.ids).toEqual([secondId, firstId]);
    editor.pointerMove(shrunk.x, shrunk.y, { shiftKey: true });
    editor.pointerUp(shrunk.x, shrunk.y, { shiftKey: true });

    expect(editor.selection.ids).toEqual([secondId]);
  });

  it("restores the starting selection when a marquee is cancelled", () => {
    editor.selection.select([secondId]);
    const down = editor.projectSceneToScreen({ x: 60, y: 60 });
    const end = editor.projectSceneToScreen({ x: 130, y: 130 });

    editor.pointerDown(down.x, down.y, { shiftKey: true });
    editor.pointerMove(end.x, end.y, { shiftKey: true });
    expect(editor.selection.ids).toEqual([secondId, firstId]);

    editor.toolManager.cancelPointerGesture();
    expect(editor.selection.ids).toEqual([secondId]);
  });

  it("undoes Escape deselection independently", async () => {
    editor.selection.select([firstId]);

    editor.escape();
    expect(editor.selection.ids).toEqual([]);

    await editor.undo();
    expect(editor.selection.ids).toEqual([firstId]);
  });

  it("waits for a pending document action before undoing it", async () => {
    editor.selectTool("pen");
    const point = editor.projectSceneToScreen({ x: 300, y: 300 });
    editor.pointerDown(point.x, point.y);
    editor.pointerUp(point.x, point.y);

    await editor.undo();

    expect(editor.pointCount).toBe(2);
  });

  it("ignores stale selection identities after scene navigation", async () => {
    await editor.clickGlyphLocal(100, 100);
    editor.scene.clear();
    editor.selection.clear();

    await editor.undo();
    await editor.redo();

    expect(editor.selection.ids).toEqual([]);
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

  it("replays multiple workspace operations captured by one action", async () => {
    const capture = editor.history.begin("Create glyphs");
    editor.selection.select([firstId]);
    editor.createGlyph("B" as GlyphName);
    editor.createGlyph("C" as GlyphName);
    capture.finish();
    await editor.settle();
    expect(editor.font.recordForName("B" as GlyphName)).not.toBeNull();
    expect(editor.font.recordForName("C" as GlyphName)).not.toBeNull();

    await editor.undo();
    expect(editor.font.recordForName("B" as GlyphName)).toBeNull();
    expect(editor.font.recordForName("C" as GlyphName)).toBeNull();
    expect(editor.selection.ids).toEqual([]);

    await editor.redo();
    expect(editor.font.recordForName("B" as GlyphName)).not.toBeNull();
    expect(editor.font.recordForName("C" as GlyphName)).not.toBeNull();
    expect(editor.selection.ids).toEqual([firstId]);
  });

  it("compounds deletion with clearing and restoring its selection", async () => {
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

  it("discards editor redo after a new selection action", async () => {
    await editor.clickGlyphLocal(100, 100);
    await editor.clickGlyphLocal(200, 200, { shiftKey: true });
    await editor.undo();

    await editor.click(9999, 9999);
    await editor.redo();

    expect(editor.selection.ids).toEqual([]);
  });

  it("rebases a later selection when an earlier workspace action fails", async () => {
    const capture = editor.history.begin("Rejected edit");
    editor.selection.select([firstId]);
    const applying = editor.font.editCoordinator.apply([
      {
        kind: "createGlyph",
        createGlyph: {
          glyphId: mintGlyphId(),
          name: "A" as GlyphName,
          unicodes: [66 as Unicode],
        },
      },
    ]);
    const rejected = expect(applying).rejects.toThrow();
    capture.finish();

    await editor.clickGlyphLocal(200, 200);
    await rejected;
    expect(editor.selection.ids).toEqual([secondId]);

    await editor.undo();
    expect(editor.selection.ids).toEqual([]);
  });

  it("discards document redo after a new selection action", async () => {
    editor.selectTool("pen");
    await editor.clickGlyphLocal(300, 300);
    await editor.undo();
    expect(editor.pointCount).toBe(2);

    editor.selectTool("select");
    await editor.clickGlyphLocal(100, 100);
    await editor.redo();

    expect(editor.pointCount).toBe(2);
    expect(editor.selection.ids).toEqual([firstId]);
  });
});
