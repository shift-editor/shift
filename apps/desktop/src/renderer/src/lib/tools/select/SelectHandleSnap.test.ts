import { beforeEach, describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

describe("Select snaps only a single cubic handle around its owning endpoint", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    await editor.clickGlyphLocal(100, 100);
    await editor.dragScene({
      down: { x: 400, y: 100 },
      start: { x: 410, y: 100 },
      end: { x: 500, y: 100 },
    });
    await editor.dragScene({
      down: { x: 700, y: 100 },
      start: { x: 710, y: 100 },
      end: { x: 800, y: 100 },
    });
    editor.selectTool("select");
  });

  it.each(["controlStart", "controlEnd"] as const)(
    "snaps %s around its own endpoint instead of the drag origin",
    async (handle) => {
      const cubic = editor.requireGlyphLayer().contours[0]!.segments()[0]!.asCubic()!;
      const pivot = handle === "controlStart" ? cubic.start : cubic.end;
      const end = { x: handle === "controlStart" ? 180 : 320, y: 160 };
      await editor.dragScene({
        down: editor.pointPosition(cubic[handle].id),
        start: end,
        end,
        options: { shiftKey: true },
      });

      const position = editor.pointPosition(cubic[handle].id);
      expect(position.x).toBeCloseTo(
        pivot.x + (handle === "controlStart" ? 1 : -1) * 50 * Math.sqrt(3),
      );
      expect(position.y).toBeCloseTo(150);
      expect(editor.pointPosition(pivot.id)).toEqual({ x: pivot.x, y: pivot.y });
      expect(editor.selection.ids).toEqual([cubic[handle].id]);
    },
  );

  it.each(["controlStart", "controlEnd"] as const)(
    "publishes a guide from the owning endpoint to the snapped %s on the first preview",
    (handle) => {
      const cubic = editor.requireGlyphLayer().contours[0]!.segments()[0]!.asCubic()!;
      const pivot = handle === "controlStart" ? cubic.start : cubic.end;
      const down = editor.projectSceneToScreen(cubic[handle]);
      const end = editor.projectSceneToScreen({ x: handle === "controlStart" ? 180 : 320, y: 160 });
      editor.pointerDown(down.x, down.y).pointerMove(end.x, end.y, { shiftKey: true });
      expect(editor.toolIf("select")?.state).toMatchObject({
        type: "translating",
        translate: {
          guides: [
            { kind: "direction", from: pivot.position, to: editor.pointPosition(cubic[handle].id) },
          ],
        },
      });
      editor.escape();
      expect(editor.toolIf("select")?.state).toEqual({ type: "ready" });
    },
  );

  it("leaves single-handle movement unconstrained without Shift", async () => {
    const cubic = editor.requireGlyphLayer().contours[0]!.segments()[0]!.asCubic()!;
    await editor.dragScene({
      down: editor.pointPosition(cubic.controlStart.id),
      start: { x: 180, y: 160 },
      end: { x: 180, y: 160 },
    });
    expect(editor.pointPosition(cubic.controlStart.id)).toEqual({ x: 180, y: 160 });
  });

  it("applies Shift changes on the current movement sample", () => {
    const cubic = editor.requireGlyphLayer().contours[0]!.segments()[0]!.asCubic()!;
    const down = editor.projectSceneToScreen(cubic.controlStart);
    const end = editor.projectSceneToScreen({ x: 180, y: 160 });
    editor.pointerDown(down.x, down.y).pointerMove(end.x, end.y);
    expect(editor.pointPosition(cubic.controlStart.id)).toEqual({ x: 180, y: 160 });
    editor.pointerMove(end.x, end.y, { shiftKey: true });
    expect(editor.pointPosition(cubic.controlStart.id).x).toBeCloseTo(100 + 50 * Math.sqrt(3));
    editor.pointerMove(end.x, end.y);
    expect(editor.pointPosition(cubic.controlStart.id)).toEqual({ x: 180, y: 160 });
    expect(editor.toolIf("select")?.state).toMatchObject({ translate: { guides: [] } });
    editor.escape();
    expect(editor.pointPosition(cubic.controlStart.id)).toEqual({ x: 200, y: 100 });
  });

  it.each([false, true])(
    "preserves snapped geometry when mouseup reports shiftKey=%s",
    async (shiftKey) => {
      const cubic = editor.requireGlyphLayer().contours[0]!.segments()[0]!.asCubic()!;
      const down = editor.projectSceneToScreen(cubic.controlStart);
      const end = editor.projectSceneToScreen({ x: 180, y: 160 });
      editor.pointerDown(down.x, down.y).pointerMove(end.x, end.y, { shiftKey: true });
      editor.pointerUp(end.x, end.y, { shiftKey });
      await editor.settle();
      expect(editor.toolIf("select")?.state).toEqual({ type: "ready" });
      expect(editor.pointPosition(cubic.controlStart.id).x).toBeCloseTo(100 + 50 * Math.sqrt(3));
      expect(editor.pointPosition(cubic.controlStart.id).y).toBeCloseTo(150);
    },
  );

  it("includes the final queued pointer position in the constrained commit", async () => {
    const cubic = editor.requireGlyphLayer().contours[0]!.segments()[0]!.asCubic()!;
    const down = editor.projectSceneToScreen(cubic.controlStart);
    const start = editor.projectSceneToScreen({ x: 180, y: 160 });
    const end = editor.projectSceneToScreen({ x: 220, y: 190 });
    editor.pointerDown(down.x, down.y).pointerMove(start.x, start.y, { shiftKey: true });
    editor.toolManager.handlePointerMove(end, { shiftKey: true, altKey: false });
    editor.pointerUp(end.x, end.y);
    await editor.settle();
    expect(editor.pointPosition(cubic.controlStart.id).x).toBeCloseTo(100 + 75 * Math.sqrt(3));
    expect(editor.pointPosition(cubic.controlStart.id).y).toBeCloseTo(175);
  });

  it("discards the preview on tool replacement and does not retain Shift in the next drag", async () => {
    const cubic = editor.requireGlyphLayer().contours[0]!.segments()[0]!.asCubic()!;
    const down = editor.projectSceneToScreen(cubic.controlStart);
    const end = editor.projectSceneToScreen({ x: 180, y: 160 });
    editor.pointerDown(down.x, down.y).pointerMove(end.x, end.y, { shiftKey: true });
    expect(editor.pointPosition(cubic.controlStart.id).x).toBeCloseTo(100 + 50 * Math.sqrt(3));
    editor.selectTool("pen");
    expect(editor.pointPosition(cubic.controlStart.id)).toEqual({ x: 200, y: 100 });
    editor.selectTool("select");
    expect(editor.toolIf("select")?.state).toEqual({ type: "ready" });
    await editor.dragScene({
      down: { x: 200, y: 100 },
      start: { x: 180, y: 160 },
      end: { x: 180, y: 160 },
    });
    expect(editor.pointPosition(cubic.controlStart.id)).toEqual({ x: 180, y: 160 });
  });

  it("commits one snapped movement with exact undo and redo", async () => {
    const cubic = editor.requireGlyphLayer().contours[0]!.segments()[0]!.asCubic()!;
    await editor.dragScene({
      down: cubic.controlStart,
      start: { x: 180, y: 160 },
      end: { x: 180, y: 160 },
      options: { shiftKey: true },
    });
    const position = editor.pointPosition(cubic.controlStart.id);
    expect(position.x).toBeCloseTo(100 + 50 * Math.sqrt(3));
    await editor.undo();
    expect(editor.pointPosition(cubic.controlStart.id)).toEqual({ x: 200, y: 100 });
    await editor.redo();
    expect(editor.pointPosition(cubic.controlStart.id)).toEqual(position);
  });

  it("leaves multi-handle selection movement unchanged with Shift", async () => {
    const cubic = editor.requireGlyphLayer().contours[0]!.segments()[0]!.asCubic()!;
    editor.selection.select([cubic.controlStart.id, cubic.controlEnd.id]);
    await editor.dragScene({
      down: cubic.controlStart,
      start: { x: 180, y: 160 },
      end: { x: 180, y: 160 },
      options: { shiftKey: true },
    });
    expect(editor.pointPosition(cubic.controlStart.id)).toEqual({ x: 180, y: 160 });
    expect(editor.pointPosition(cubic.controlEnd.id)).toEqual({ x: 280, y: 160 });
  });

  it("snaps a Bézier on-curve point around its original position", async () => {
    const cubic = editor.requireGlyphLayer().contours[0]!.segments()[0]!.asCubic()!;
    await editor.dragScene({
      down: cubic.start,
      start: { x: 130, y: 140 },
      end: { x: 130, y: 140 },
      options: { shiftKey: true },
    });
    expect(editor.pointPosition(cubic.start.id).x).toBeCloseTo(125);
    expect(editor.pointPosition(cubic.start.id).y).toBeCloseTo(100 + 25 * Math.sqrt(3));
  });

  it("preserves the opposite handle's length and smooth tangency after snapping", async () => {
    const cubics = editor
      .requireGlyphLayer()
      .contours[0]!.segments()
      .map((segment) => segment.asCubic()!);
    const incoming = cubics[0]!;
    const outgoing = cubics[1]!;
    await editor.dragScene({
      down: incoming.controlEnd,
      start: { x: 320, y: 160 },
      end: { x: 320, y: 160 },
      options: { shiftKey: true },
    });
    expect(editor.pointPosition(incoming.controlEnd.id).x).toBeCloseTo(400 - 50 * Math.sqrt(3));
    expect(editor.pointPosition(incoming.controlEnd.id).y).toBeCloseTo(150);
    expect(editor.pointPosition(outgoing.controlStart.id).x).toBeCloseTo(400 + 50 * Math.sqrt(3));
    expect(editor.pointPosition(outgoing.controlStart.id).y).toBeCloseTo(50);
    expect(editor.pointPosition(incoming.end.id)).toEqual({ x: 400, y: 100 });
  });
});
