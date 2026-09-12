import { beforeEach, describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

describe("Pen snaps mirrored creation handles around the new endpoint", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    await editor.clickGlyphLocal(100, 100);
  });

  it.each([
    { pointer: { x: 380, y: 120 }, angle: 15 },
    { pointer: { x: 380, y: 160 }, angle: 30 },
    { pointer: { x: 330, y: 140 }, angle: 60 },
  ])(
    "publishes complete topology and mirrored handles at $angle degrees on the first preview",
    ({ pointer, angle }) => {
      const down = editor.projectSceneToScreen({ x: 300, y: 100 });
      const end = editor.projectSceneToScreen(pointer);
      editor.pointerDown(down.x, down.y).pointerMove(end.x, end.y, { shiftKey: true });
      const cubic = editor.openContour!.segments()[0]!.asCubic()!;
      const state = editor.toolIf("pen")?.state;
      if (state?.type !== "dragging") throw new Error("Expected Pen drag preview");
      const length = Math.hypot(pointer.x - 300, pointer.y - 100);
      expect(cubic.controlEnd.x).toBeCloseTo(300 - length * Math.cos((angle * Math.PI) / 180));
      expect(cubic.controlEnd.y).toBeCloseTo(100 - length * Math.sin((angle * Math.PI) / 180));
      expect(state.curve.handlePosition.x).toBeCloseTo(600 - cubic.controlEnd.x);
      expect(state.curve.handlePosition.y).toBeCloseTo(200 - cubic.controlEnd.y);
      expect(cubic.end.position).toEqual({ x: 300, y: 100 });
      expect(state.guides).toEqual([
        { kind: "direction", from: cubic.end.position, to: state.curve.handlePosition },
      ]);
      expect(editor.pointCount).toBe(4);
      editor.escape();
      expect(editor.pointCount).toBe(1);
      expect(editor.toolIf("pen")?.state).toEqual({ type: "ready" });
    },
  );

  it("applies Shift changes on the current drag sample without accumulating previews", () => {
    const down = editor.projectSceneToScreen({ x: 300, y: 100 });
    const end = editor.projectSceneToScreen({ x: 380, y: 160 });
    editor.pointerDown(down.x, down.y).pointerMove(end.x, end.y);
    expect(editor.openContour!.segments()[0]!.asCubic()!.controlEnd.position).toEqual({
      x: 220,
      y: 40,
    });
    editor.pointerMove(end.x, end.y, { shiftKey: true });
    expect(editor.openContour!.segments()[0]!.asCubic()!.controlEnd.y).toBeCloseTo(50);
    editor.pointerMove(end.x, end.y);
    expect(editor.toolIf("pen")?.state).toMatchObject({ type: "dragging", guides: [] });
    expect(editor.openContour!.segments()[0]!.asCubic()!.controlEnd.position).toEqual({
      x: 220,
      y: 40,
    });
    editor.escape();
  });

  it("keeps visual feedback for horizontal Pen handle snapping", () => {
    const down = editor.projectSceneToScreen({ x: 300, y: 100 });
    const end = editor.projectSceneToScreen({ x: 380, y: 100 });
    editor.pointerDown(down.x, down.y).pointerMove(end.x, end.y, { shiftKey: true });
    const state = editor.toolIf("pen")?.state;
    if (state?.type !== "dragging") throw new Error("Expected Pen drag preview");
    expect(state.guides).toEqual([
      { kind: "direction", from: { x: 300, y: 100 }, to: state.curve.handlePosition },
    ]);
    editor.escape();
  });

  it.each([false, true])(
    "preserves a constrained creation when mouseup reports shiftKey=%s",
    async (shiftKey) => {
      const down = editor.projectSceneToScreen({ x: 300, y: 100 });
      const end = editor.projectSceneToScreen({ x: 380, y: 160 });
      editor.pointerDown(down.x, down.y).pointerMove(end.x, end.y, { shiftKey: true });
      const preview = editor.openContour!.segments()[0]!.asCubic()!.controlEnd.position;
      expect(preview.x).toBeCloseTo(300 - 50 * Math.sqrt(3));
      expect(preview.y).toBeCloseTo(50);
      editor.pointerUp(end.x, end.y, { shiftKey });
      await editor.settle();
      expect(editor.toolIf("pen")?.state).toEqual({ type: "ready" });
      expect(editor.openContour!.segments()[0]!.asCubic()!.controlEnd.position).toEqual(preview);
    },
  );

  it("commits the final queued position while leaving the anchor and prior control fixed", async () => {
    const down = editor.projectSceneToScreen({ x: 300, y: 100 });
    const start = editor.projectSceneToScreen({ x: 380, y: 160 });
    const end = editor.projectSceneToScreen({ x: 420, y: 190 });
    editor.pointerDown(down.x, down.y).pointerMove(start.x, start.y, { shiftKey: true });
    editor.toolManager.handlePointerMove(end, { shiftKey: true, altKey: false });
    editor.pointerUp(end.x, end.y);
    await editor.settle();
    const cubic = editor.openContour!.segments()[0]!.asCubic()!;
    expect(cubic.controlEnd.x).toBeCloseTo(300 - 75 * Math.sqrt(3));
    expect(cubic.controlEnd.y).toBeCloseTo(25);
    expect(cubic.controlStart.x).toBeCloseTo(100 + 200 / 3);
    expect(cubic.controlStart.y).toBe(100);
    expect(cubic.end.position).toEqual({ x: 300, y: 100 });
  });

  it("undoes and redoes topology and snapped positions together", async () => {
    await editor.dragScene({
      down: { x: 300, y: 100 },
      start: { x: 380, y: 160 },
      end: { x: 380, y: 160 },
      options: { shiftKey: true },
    });
    const points = editor.openContour!.points.map((point) => ({
      id: point.id,
      position: point.position,
    }));
    expect(points).toHaveLength(4);
    expect(points[2]!.position.y).toBeCloseTo(50);
    await editor.undo();
    expect(editor.pointCount).toBe(1);
    await editor.redo();
    expect(
      editor.openContour!.points.map((point) => ({ id: point.id, position: point.position })),
    ).toEqual(points);
  });

  it("carries the snapped outgoing handle into the next cubic", async () => {
    await editor.dragScene({
      down: { x: 300, y: 100 },
      start: { x: 380, y: 160 },
      end: { x: 380, y: 160 },
      options: { shiftKey: true },
    });
    await editor.dragScene({
      down: { x: 500, y: 100 },
      start: { x: 580, y: 180 },
      end: { x: 580, y: 180 },
    });
    const cubics = editor.openContour!.segments().map((segment) => segment.asCubic()!);
    expect(cubics[0]!.end.smooth).toBe(true);
    expect(cubics[0]!.controlEnd.x).toBeCloseTo(300 - 50 * Math.sqrt(3));
    expect(cubics[1]!.controlStart.x).toBeCloseTo(300 + 50 * Math.sqrt(3));
    expect(cubics[1]!.controlStart.y).toBeCloseTo(150);
    expect(cubics[1]!.controlEnd.position).toEqual({ x: 420, y: 20 });
  });

  it("discards a consecutive snapped curve without damaging its previous smoothness or tangent", async () => {
    await editor.dragScene({
      down: { x: 300, y: 100 },
      start: { x: 380, y: 160 },
      end: { x: 380, y: 160 },
      options: { shiftKey: true },
    });
    const points = editor.openContour!.points.map((point) => ({
      id: point.id,
      position: point.position,
      smooth: point.smooth,
    }));
    const down = editor.projectSceneToScreen({ x: 500, y: 100 });
    const end = editor.projectSceneToScreen({ x: 580, y: 160 });
    editor.pointerDown(down.x, down.y).pointerMove(end.x, end.y, { shiftKey: true });
    expect(editor.pointCount).toBe(7);
    editor.escape();
    expect(
      editor.openContour!.points.map((point) => ({
        id: point.id,
        position: point.position,
        smooth: point.smooth,
      })),
    ).toEqual(points);
  });

  it("cancels point creation on tool replacement", () => {
    const down = editor.projectSceneToScreen({ x: 300, y: 100 });
    const end = editor.projectSceneToScreen({ x: 380, y: 160 });
    editor.pointerDown(down.x, down.y).pointerMove(end.x, end.y, { shiftKey: true });
    expect(editor.pointCount).toBe(4);
    editor.selectTool("select");
    expect(editor.pointCount).toBe(1);
    expect(editor.openContour!.points[0]!.position).toEqual({ x: 100, y: 100 });
    editor.selectTool("pen");
    expect(editor.toolIf("pen")?.state).toEqual({ type: "ready" });
  });

  it("allows the pointer to return to the anchor without invalid coordinates", () => {
    const down = editor.projectSceneToScreen({ x: 300, y: 100 });
    const end = editor.projectSceneToScreen({ x: 380, y: 160 });
    editor.pointerDown(down.x, down.y).pointerMove(end.x, end.y, { shiftKey: true });
    editor.pointerMove(down.x, down.y, { shiftKey: true });
    expect(editor.openContour!.segments()[0]!.asCubic()!.controlEnd.position).toEqual({
      x: 300,
      y: 100,
    });
    editor.escape();
  });

  it("keeps Shift-click placement as a straight segment", async () => {
    await editor.clickGlyphLocal(300, 100, { shiftKey: true });
    expect(editor.pointCount).toBe(2);
    expect(editor.openContour!.segments()[0]!.type).toBe("line");
    expect(editor.openContour!.lastPoint!.position).toEqual({ x: 300, y: 100 });
  });
});
