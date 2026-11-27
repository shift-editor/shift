import { describe, expect, it } from "vitest";
import type { OutlineStrokeStyle, PointId } from "@shift/types";
import type { ContourPoints } from "@shift/wasm/protocol";
import { applyDynamicStroke } from "@/lib/commands/strokeCommands";
import { useTestEditor } from "@/testing/fontFixture";
import type { OutlineContour } from "@/testing/reads";
import type { EditorTestSurface } from "@/testing/surface";

const ROUND_20: OutlineStrokeStyle = {
  width: 20,
  cap: "round",
  join: "round",
  miterLimit: 4,
  position: 0,
};

const editor = useTestEditor();

/** Draws one open line with the Pen, makes it a dynamic stroke and starts recording the canvas. */
async function strokedLine(): Promise<{ readonly start: PointId; readonly end: PointId }> {
  editor.selectTool("pen");
  await editor.clickAt({ x: 100, y: 100 });
  await editor.clickAt({ x: 400, y: 100 });
  await editor.pressKey("Escape");
  editor.selectTool("select");

  const [line] = await editor.outline();
  const [start, end] = (line as OutlineContour).points;
  editor.select([start!.id as PointId]);
  expect(applyDynamicStroke(editor.asEditor(), ROUND_20)).toEqual({ ok: true });
  await editor.settle();
  editor.recordCanvas();
  await expect.poll(() => drawnFills(editor).length).toBeGreaterThan(0);

  return { start: start!.id as PointId, end: end!.id as PointId };
}

/** Waits until a frame has been drawn since this call. */
async function nextFrame(surface: EditorTestSurface): Promise<void> {
  const before = surface.canvasFrameCount();
  surface.passFrame();
  await expect.poll(() => surface.canvasFrameCount()).toBeGreaterThan(before);
  await surface.settle();
}

/** What the canvas fills for the open glyph's dynamic strokes in its latest frame. */
function drawnFills(surface: EditorTestSurface): readonly ContourPoints[] {
  return surface.drawnStrokeFills();
}

describe("the clean ink view while the hand tool is active", () => {
  it("hides handles and the solved edge while Space is held, and keeps the ink fill", async () => {
    const { start, end } = await strokedLine();
    editor.select([start, end]);
    await nextFrame(editor);

    expect(editor.drawnHandles().length).toBeGreaterThan(0);
    expect(editor.strokeFillsOutlined()).toBe(true);

    editor.holdSpaceForHand();
    await nextFrame(editor);

    expect(editor.drawnHandles()).toEqual([]);
    expect(editor.strokeFillsOutlined()).toBe(false);
    expect(drawnFills(editor).length).toBeGreaterThan(0);

    editor.releaseSpace();
    await nextFrame(editor);

    expect(editor.drawnHandles().length).toBeGreaterThan(0);
    expect(editor.strokeFillsOutlined()).toBe(true);
  });

  it("hides the chrome while the hand tool is selected, and brings it back with Select", async () => {
    const { start, end } = await strokedLine();
    editor.select([start, end]);

    editor.selectTool("hand");
    await nextFrame(editor);

    expect(editor.drawnHandles()).toEqual([]);
    expect(editor.strokeFillsOutlined()).toBe(false);
    expect(drawnFills(editor).length).toBeGreaterThan(0);

    editor.selectTool("select");
    await nextFrame(editor);

    expect(editor.drawnHandles().length).toBeGreaterThan(0);
    expect(editor.strokeFillsOutlined()).toBe(true);
  });

  it("keeps the ink drawn while panning with Space held", async () => {
    await strokedLine();

    editor.holdSpaceForHand();
    await editor.dragFrom({ x: 0, y: 0 }, { x: 120, y: -80 });
    await nextFrame(editor);

    expect(drawnFills(editor).length).toBeGreaterThan(0);
    expect(editor.strokeFillsOutlined()).toBe(false);
    expect(editor.drawnHandles()).toEqual([]);

    editor.releaseSpace();
  });

  it("leaves a plain glyph's fill and drops its edge and handles", async () => {
    editor.selectTool("pen");
    for (const point of [
      { x: 100, y: 100 },
      { x: 400, y: 100 },
      { x: 400, y: 400 },
      { x: 100, y: 400 },
      { x: 100, y: 100 },
    ]) {
      await editor.clickAt(point);
    }
    await editor.pressKey("Escape");
    editor.selectTool("select");
    editor.recordCanvas();
    await nextFrame(editor);

    const editing = editor.latestCanvasFrame();
    const editingGeometry = editor.canvasFills();
    expect(editing.fills.length).toBeGreaterThan(0);
    expect(editing.strokes.length).toBeGreaterThan(0);
    expect(editor.drawnHandles().length).toBeGreaterThan(0);

    editor.holdSpaceForHand();
    await nextFrame(editor);

    const clean = editor.latestCanvasFrame();
    expect(clean.fills).toHaveLength(editing.fills.length);
    expect(editor.canvasFills()).toEqual(editingGeometry);
    expect(clean.strokes).toEqual([]);
    expect(editor.drawnHandles()).toEqual([]);

    editor.releaseSpace();
  });

  it("still draws a failed stroke's skeleton plainly while peeking", async () => {
    const { end } = await strokedLine();
    editor.select([end]);

    // Deleting one end leaves a skeleton too short for the stroke to follow.
    await editor.deleteSelection();
    await editor.settle();
    await expect.poll(() => editor.strokeProblems().length).toBeGreaterThan(0);
    expect(drawnFills(editor)).toEqual([]);

    editor.holdSpaceForHand();
    await nextFrame(editor);

    expect(drawnFills(editor)).toEqual([]);
    expect(editor.latestCanvasFrame().strokes.length).toBeGreaterThan(0);
    expect(editor.strokeProblems().length).toBeGreaterThan(0);

    editor.releaseSpace();
  });
});
