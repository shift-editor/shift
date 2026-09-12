import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";

describe("Select translates segment selections in 90-degree directions", () => {
  let editor: TestEditor;
  let firstId: PointId;
  let middleId: PointId;
  let lastId: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    [firstId, middleId, lastId] = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
    ]);
    editor.selectTool("select");
  });

  it.each([false, true])(
    "snaps a single line with preselection=%s, including its auto-selected point IDs",
    async (selected) => {
      if (selected) await editor.clickGlyphLocal(150, 100);
      await editor.dragScene({
        down: { x: 150, y: 100 },
        start: { x: 210, y: 180 },
        end: { x: 210, y: 180 },
        options: { shiftKey: true },
      });
      expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 200 });
      expect(editor.pointPosition(middleId)).toEqual({ x: 300, y: 200 });
      expect(editor.pointPosition(lastId)).toEqual({ x: 300, y: 300 });
    },
  );

  it("moves multiple selected segments together without moving their shared point twice", async () => {
    const layer = editor.requireGlyphLayer();
    layer.closeContour(layer.contours[0]!.id);
    await editor.settle();
    await editor.clickGlyphLocal(150, 100);
    await editor.clickGlyphLocal(200, 200, { shiftKey: true });
    expect(editor.selection.ids).toHaveLength(2);
    await editor.dragScene({
      down: { x: 200, y: 200 },
      start: { x: 260, y: 280 },
      end: { x: 260, y: 280 },
      options: { shiftKey: true },
    });
    expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 200 });
    expect(editor.pointPosition(middleId)).toEqual({ x: 300, y: 200 });
    expect(editor.pointPosition(lastId)).toEqual({ x: 300, y: 400 });
  });

  it("uses the segment group when dragging inside its combined bounds", async () => {
    await editor.clickGlyphLocal(150, 100);
    await editor.clickGlyphLocal(300, 150, { shiftKey: true });
    await editor.dragScene({
      down: { x: 200, y: 200 },
      start: { x: 280, y: 260 },
      end: { x: 280, y: 260 },
      options: { shiftKey: true },
    });
    expect(editor.pointPosition(firstId)).toEqual({ x: 200, y: 100 });
    expect(editor.pointPosition(middleId)).toEqual({ x: 400, y: 100 });
    expect(editor.pointPosition(lastId)).toEqual({ x: 400, y: 300 });
  });

  it("omits guides for axis-aligned segment snapping", async () => {
    await editor.clickGlyphLocal(150, 100);
    await editor.clickGlyphLocal(300, 150, { shiftKey: true });
    const down = editor.projectSceneToScreen({ x: 200, y: 200 });
    const end = editor.projectSceneToScreen({ x: 280, y: 260 });
    editor.pointerDown(down.x, down.y).pointerMove(end.x, end.y, { shiftKey: true });
    editor.pointerMove(end.x, end.y, { shiftKey: true });
    expect(editor.toolIf("select")?.state).toMatchObject({
      type: "translating",
      translate: { guides: [] },
    });
    editor.escape();
    expect(editor.toolIf("select")?.state).toEqual({ type: "ready" });
  });

  it("snaps cubic segment translation without changing its shape", async () => {
    const layer = editor.requireGlyphLayer();
    layer.upgradeLineToCubic(layer.contours[0]!.segments()[0]!.id);
    await editor.settle();
    const cubic = layer.contours[0]!.segments()[0]!.asCubic()!;
    const before = cubic.controlStart.y;
    await editor.dragScene({
      down: { x: 200, y: 100 },
      start: { x: 260, y: 180 },
      end: { x: 260, y: 180 },
      options: { shiftKey: true },
    });
    expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 200 });
    expect(editor.pointPosition(middleId)).toEqual({ x: 300, y: 200 });
    expect(editor.pointPosition(cubic.controlStart.id).x).toBeCloseTo(cubic.controlStart.x);
    expect(editor.pointPosition(cubic.controlStart.id).y).toBeCloseTo(before + 100);
    expect(editor.pointPosition(cubic.controlEnd.id).x).toBeCloseTo(cubic.controlEnd.x);
    expect(editor.pointPosition(cubic.controlEnd.id).y).toBeCloseTo(before + 100);
  });

  it("leaves an extra independently selected point unconstrained", async () => {
    const layer = editor.requireGlyphLayer();
    layer.closeContour(layer.contours[0]!.id);
    await editor.settle();
    editor.selection.select([layer.contours[0]!.segments()[2]!.id, middleId]);
    await editor.dragScene({
      down: { x: 200, y: 200 },
      start: { x: 260, y: 280 },
      end: { x: 260, y: 280 },
      options: { shiftKey: true },
    });
    expect(editor.pointPosition(firstId)).toEqual({ x: 160, y: 180 });
    expect(editor.pointPosition(middleId)).toEqual({ x: 360, y: 180 });
    expect(editor.pointPosition(lastId)).toEqual({ x: 360, y: 380 });
  });

  it("leaves a segment-and-anchor selection unconstrained", async () => {
    const layer = editor.requireGlyphLayer();
    const anchorId = layer.addAnchor("top", { x: 500, y: 500 });
    layer.closeContour(layer.contours[0]!.id);
    await editor.settle();
    editor.selection.select([layer.contours[0]!.segments()[2]!.id, anchorId]);
    await editor.dragScene({
      down: { x: 200, y: 200 },
      start: { x: 260, y: 280 },
      end: { x: 260, y: 280 },
      options: { shiftKey: true },
    });
    expect(editor.pointPosition(firstId)).toEqual({ x: 160, y: 180 });
    expect(editor.anchorPosition(anchorId)).toEqual({ x: 560, y: 580 });
  });

  it("resizes a selection edge even when a selected segment occupies that edge", async () => {
    await editor.clickGlyphLocal(150, 100);
    await editor.clickGlyphLocal(300, 150, { shiftKey: true });
    const down = editor.projectSceneToScreen({ x: 150, y: 100 });
    const end = editor.projectSceneToScreen({ x: 210, y: 180 });
    editor.pointerDown(down.x, down.y).pointerMove(end.x, end.y, { shiftKey: true });
    expect(editor.toolIf("select")?.state.type).toBe("resizing");
    editor.pointerUp(end.x, end.y);
    await editor.settle();
    expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 180 });
    expect(editor.pointPosition(middleId)).toEqual({ x: 300, y: 180 });
    expect(editor.pointPosition(lastId)).toEqual({ x: 300, y: 300 });
  });

  it("leaves segment movement unchanged without Shift", async () => {
    await editor.dragScene({
      down: { x: 150, y: 100 },
      start: { x: 210, y: 180 },
      end: { x: 210, y: 180 },
    });
    expect(editor.pointPosition(firstId)).toEqual({ x: 160, y: 180 });
    expect(editor.pointPosition(middleId)).toEqual({ x: 360, y: 180 });
  });

  it("recomputes from the frozen base as Shift toggles and Escape cancels", () => {
    const down = editor.projectSceneToScreen({ x: 150, y: 100 });
    const end = editor.projectSceneToScreen({ x: 210, y: 180 });
    editor.pointerDown(down.x, down.y).pointerMove(end.x, end.y, { shiftKey: true });
    expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 200 });
    editor.pointerMove(end.x, end.y);
    expect(editor.pointPosition(firstId)).toEqual({ x: 160, y: 180 });
    expect(editor.toolIf("select")?.state).toMatchObject({ translate: { guides: [] } });
    editor.pointerMove(end.x, end.y, { shiftKey: true });
    expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 200 });
    editor.escape();
    expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
    expect(editor.pointPosition(middleId)).toEqual({ x: 300, y: 100 });
  });

  it("preserves the final queued Shift sample through release, undo, and redo", async () => {
    const down = editor.projectSceneToScreen({ x: 150, y: 100 });
    const start = editor.projectSceneToScreen({ x: 180, y: 140 });
    const end = editor.projectSceneToScreen({ x: 210, y: 180 });
    editor.pointerDown(down.x, down.y).pointerMove(start.x, start.y, { shiftKey: true });
    editor.toolManager.handlePointerMove(end, { shiftKey: true, altKey: false });
    editor.pointerUp(end.x, end.y);
    await editor.settle();
    expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 200 });
    await editor.undo();
    expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
    await editor.redo();
    expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 200 });
  });
});
