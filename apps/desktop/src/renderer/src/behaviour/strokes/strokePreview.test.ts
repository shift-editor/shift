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

interface Extent {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** The box around every coordinate of `outlines`, controls included. */
function extentOf(outlines: readonly ContourPoints[]): Extent {
  const xs = outlines.flatMap((outline) =>
    outline.coordinates.filter((_, index) => index % 2 === 0),
  );
  const ys = outlines.flatMap((outline) =>
    outline.coordinates.filter((_, index) => index % 2 === 1),
  );

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** Twice the signed area of `outline`'s on-curve polygon: its sign is the way it winds. */
function winding(outline: ContourPoints): number {
  const points = outline.pointTypes.flatMap((type, index) =>
    type === "onCurve"
      ? [{ x: outline.coordinates[index * 2]!, y: outline.coordinates[index * 2 + 1]! }]
      : [],
  );

  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]!;

    return sum + (point.x * next.y - next.x * point.y);
  }, 0);
}

/** What the canvas fills for the open glyph's dynamic strokes in its latest frame. */
function drawn(editor: EditorTestSurface): readonly ContourPoints[] {
  return editor.drawnStrokeFills();
}

/** What the engine solves for them, whether or not a frame has drawn it. */
function solved(editor: EditorTestSurface): readonly ContourPoints[] {
  return editor.strokeOutlinePreviews().items.flatMap((item) => item.outlines);
}

async function waitForDrawn(editor: EditorTestSurface): Promise<readonly ContourPoints[]> {
  await expect.poll(() => drawn(editor).length).toBeGreaterThan(0);

  return drawn(editor);
}

describe("a dynamic stroke on the editing canvas", () => {
  const editor = useTestEditor();

  /** Draws one open line with the Pen, makes it a dynamic stroke and starts recording the canvas. */
  async function strokedLine(
    style: OutlineStrokeStyle = ROUND_20,
  ): Promise<{ readonly start: PointId; readonly end: PointId }> {
    editor.selectTool("pen");
    await editor.clickAt({ x: 100, y: 100 });
    await editor.clickAt({ x: 400, y: 100 });
    await editor.pressKey("Escape");
    editor.selectTool("select");

    const [line] = await editor.outline();
    const [start, end] = (line as OutlineContour).points;
    editor.select([start!.id as PointId]);
    expect(applyDynamicStroke(editor.asEditor(), style)).toEqual({ ok: true });
    await editor.settle();
    editor.recordCanvas();

    return { start: start!.id as PointId, end: end!.id as PointId };
  }

  it("draws the solved outline of the skeleton, not just the skeleton", async () => {
    await strokedLine();

    const extent = extentOf(await waitForDrawn(editor));

    expect(extent.minX).toBeCloseTo(90, 0);
    expect(extent.maxX).toBeCloseTo(410, 0);
    expect(extent.minY).toBeCloseTo(90, 0);
    expect(extent.maxY).toBeCloseTo(110, 0);
  });

  it("draws the stroke on the side its position names", async () => {
    // The line runs left to right, so the left of travel is up.
    await strokedLine({ ...ROUND_20, position: -1 });
    const left = extentOf(await waitForDrawn(editor));

    expect(left.minY).toBeCloseTo(100, 0);
    expect(left.maxY).toBeCloseTo(120, 0);
  });

  it("draws the stroke below the line at a position of +100%", async () => {
    await strokedLine({ ...ROUND_20, position: 1 });
    const right = extentOf(await waitForDrawn(editor));

    expect(right.minY).toBeCloseTo(80, 0);
    expect(right.maxY).toBeCloseTo(100, 0);
  });

  it("draws the edge of the solved outline, so the stroke is visible against the page", async () => {
    await strokedLine();
    await waitForDrawn(editor);

    expect(editor.strokeFillsOutlined()).toBe(true);
  });

  it("follows the skeleton frame by frame while an endpoint is dragged", async () => {
    const { end } = await strokedLine();
    await waitForDrawn(editor);
    editor.select([end]);

    editor.holdDrag(end, { x: 100, y: 150 });
    await expect.poll(() => extentOf(drawn(editor)).maxY).toBeGreaterThan(200);
    const firstFrame = extentOf(drawn(editor));

    editor.movePointerTo({ x: 600, y: 400 });
    await expect.poll(() => extentOf(drawn(editor)).maxX).toBeGreaterThan(firstFrame.maxX + 50);
    const secondFrame = extentOf(drawn(editor));

    expect(secondFrame.maxY).toBeGreaterThan(firstFrame.maxY);
    expect(drawn(editor)).toEqual(solved(editor));
  });

  it("settles on exactly the last frame it drew when the drag is released", async () => {
    const { end } = await strokedLine();
    await waitForDrawn(editor);
    editor.select([end]);

    editor.holdDrag(end, { x: 100, y: 150 });
    await expect.poll(() => extentOf(drawn(editor)).maxY).toBeGreaterThan(200);
    editor.movePointerTo({ x: 600, y: 400 });
    await expect.poll(() => extentOf(drawn(editor)).maxX).toBeGreaterThan(550);
    const lastFrame = drawn(editor);

    await editor.releaseAt({ x: 600, y: 400 });
    await editor.settle();

    expect(solved(editor)).toEqual(lastFrame);
    await expect.poll(() => drawn(editor)).toEqual(lastFrame);
  });

  it("goes back to the committed outline when the drag is abandoned", async () => {
    const { end } = await strokedLine();
    const committed = await waitForDrawn(editor);
    editor.select([end]);

    editor.holdDrag(end, { x: 100, y: 150 });
    await expect.poll(() => extentOf(drawn(editor)).maxY).toBeGreaterThan(200);
    editor.cancelGesture();
    await editor.settle();

    await expect.poll(() => drawn(editor)).toEqual(committed);
  });

  it("redraws the same solved path when only the view changes", async () => {
    await strokedLine();
    await waitForDrawn(editor);
    const before = editor.latestCanvasFrame().fills;
    const zoomBefore = editor.zoomLevel();

    editor.setZoom(zoomBefore * 1.5);
    editor.passFrame();
    await editor.settle();

    expect(editor.zoomLevel()).not.toBe(zoomBefore);
    expect(editor.latestCanvasFrame().fills).toEqual(before);
    expect(drawn(editor).length).toBeGreaterThan(0);
  });

  it("draws a closed skeleton as a ring of two outlines", async () => {
    editor.selectTool("pen");
    for (const point of [
      { x: 100, y: 100 },
      { x: 400, y: 100 },
      { x: 400, y: 400 },
      { x: 100, y: 100 },
    ]) {
      await editor.clickAt(point);
    }
    await editor.pressKey("Escape");
    editor.selectTool("select");
    const [triangle] = await editor.outline();
    editor.select([triangle!.points[0]!.id as PointId]);
    expect(applyDynamicStroke(editor.asEditor(), ROUND_20)).toEqual({ ok: true });
    await editor.settle();
    editor.recordCanvas();

    const outlines = await waitForDrawn(editor);

    expect(outlines).toHaveLength(2);
    expect(outlines.every((outline) => outline.closed)).toBe(true);
    // Filled nonzero, outlines that wind opposite ways leave the middle empty: a ring, not a disc.
    expect(Math.sign(winding(outlines[0]!))).toBe(-Math.sign(winding(outlines[1]!)));
  });

  it("says once why a stroke cannot be drawn, and draws its contour plainly meanwhile", async () => {
    const { end } = await strokedLine();
    await waitForDrawn(editor);
    editor.select([end]);

    // Dragging the end onto the start leaves a skeleton with no length for the stroke to follow.
    editor.holdDrag(end, { x: -300, y: 0 });
    await expect.poll(() => editor.strokeProblems().length).toBe(1);

    expect(editor.strokeProblems()[0]).toMatch(/^A dynamic stroke could not be drawn: .+\.$/);
    expect(drawn(editor)).toEqual([]);

    // Frames that follow, with the skeleton still collapsed, redraw it without saying it again.
    for (const x of [101, 100, 102]) {
      const framesBefore = editor.canvasFrameCount();
      editor.movePointerTo({ x, y: 100 });
      await expect.poll(() => editor.canvasFrameCount()).toBeGreaterThan(framesBefore);
      expect(drawn(editor)).toEqual([]);
    }
    expect(editor.strokeProblems()).toHaveLength(1);

    editor.cancelGesture();
  });

  it("keeps drawing the strokes that can be solved while another one cannot", async () => {
    editor.selectTool("pen");
    await editor.clickAt({ x: 100, y: 100 });
    await editor.clickAt({ x: 400, y: 100 });
    await editor.pressKey("Escape");
    await editor.clickAt({ x: 100, y: 300 });
    await editor.clickAt({ x: 400, y: 300 });
    await editor.pressKey("Escape");
    editor.selectTool("select");
    const [lower, upper] = (await editor.outline()) as OutlineContour[];
    const starts = [lower!, upper!].map((contour) => contour.points[0]!.id as PointId);
    const upperEnd = upper!.points[1]!.id as PointId;
    editor.select(starts);
    expect(applyDynamicStroke(editor.asEditor(), ROUND_20)).toEqual({ ok: true });
    await editor.settle();
    editor.recordCanvas();
    await expect.poll(() => drawn(editor).length).toBe(2);

    editor.select([upperEnd]);
    editor.holdDrag(upperEnd, { x: -300, y: 0 });
    await expect.poll(() => editor.strokeProblems().length).toBe(1);

    await expect.poll(() => drawn(editor).length).toBe(1);
    expect(editor.strokeProblems()[0]).toMatch(/^A dynamic stroke could not be drawn: .+\.$/);
    const remaining = extentOf(drawn(editor));
    expect(remaining.minY).toBeCloseTo(90, 0);
    expect(remaining.maxY).toBeCloseTo(110, 0);

    editor.cancelGesture();
  });

  it("draws the stroke again once the skeleton can be followed, and reports a later failure", async () => {
    const { end } = await strokedLine();
    await waitForDrawn(editor);
    editor.select([end]);

    editor.holdDrag(end, { x: -300, y: 0 });
    await expect.poll(() => editor.strokeProblems().length).toBe(1);

    editor.movePointerTo({ x: 300, y: 100 });
    await expect.poll(() => drawn(editor).length).toBeGreaterThan(0);

    editor.movePointerTo({ x: 100, y: 100 });
    await expect.poll(() => editor.strokeProblems().length).toBe(2);

    editor.cancelGesture();
  });

  it("follows the Pen while it places the skeleton's next point, before the gesture ends", async () => {
    await strokedLine();
    await waitForDrawn(editor);
    const before = extentOf(drawn(editor));

    editor.selectTool("pen");
    await editor.clickAt({ x: 400, y: 100 });
    editor.pressAt({ x: 400, y: 300 });
    editor.movePointerTo({ x: 460, y: 340 });

    await expect.poll(() => extentOf(drawn(editor)).maxY).toBeGreaterThan(before.maxY + 100);
    expect(drawn(editor)).toEqual(solved(editor));

    await editor.releaseAt({ x: 460, y: 340 });
    await editor.settle();

    expect(solved(editor)).toEqual(drawn(editor));
  });
});
