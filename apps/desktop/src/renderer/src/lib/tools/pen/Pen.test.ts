import { describe, it, expect, beforeEach } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

/**
 * Restored from the WS6 behavioral inventory (git show ef037c6e^), rebuilt
 * on the workspace stack: every gesture flows intents → real NAPI → SQLite
 * → echo → fold. `settle()` awaits the echo so assertions read confirmed
 * truth, the same state a user sees one frame later.
 */
describe("Pen tool", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
  });

  describe("point creation", () => {
    it("adds a point on click", async () => {
      await editor.click(100, 200);

      const contour = editor.openContour;
      expect(contour?.points.length).toBe(1);
    });
  });

  describe("creating segments", () => {
    it("adding two points creates a line segment", async () => {
      await editor.click(100, 200);
      await editor.click(300, 200);

      const segment = editor.openContour?.segments()[0];

      expect(segment?.type).toBe("line");
    });

    it("adding three points creates two line segments", async () => {
      await editor.click(100, 200);
      await editor.click(300, 200);
      await editor.click(500, 200);

      const contour = editor.openContour;
      expect(contour?.segments().length).toBe(2);

      expect(contour?.segments()[0]?.type).toBe("line");
      expect(contour?.segments()[1]?.type).toBe("line");
    });

    it("clicking the first point closes the contour and ends the stroke", async () => {
      await editor.click(100, 200);
      await editor.click(300, 200);
      await editor.click(200, 100);

      await editor.click(100, 200); // back on the first point

      const contour = editor.glyphContours[0];
      expect(contour?.closed).toBe(true);
      expect(contour?.points.length).toBe(3);
      expect(editor.openContour).toBeNull();
    });

    it("publishes complete local curve topology while the drag is active", async () => {
      await editor.clickLocal(100, 100);
      const down = editor.localToScreen({ x: 300, y: 100 });
      const threshold = editor.localToScreen({ x: 340, y: 120 });
      const end = editor.localToScreen({ x: 380, y: 180 });

      editor.pointerDown(down.x, down.y);
      editor.pointerMove(threshold.x, threshold.y);
      await editor.settle();

      expect(editor.openContour?.points).toHaveLength(4);
      expect(editor.openContour?.segments()[0]?.type).toBe("cubic");
      expect(editor.openContour?.lastPoint?.isOnCurve).toBe(true);

      editor.pointerUp(end.x, end.y);
      await editor.settle();
      expect(editor.openContour?.segments()[0]?.type).toBe("cubic");
    });

    it("restores the authored topology when an active curve is canceled", async () => {
      await editor.clickLocal(100, 100);
      const down = editor.localToScreen({ x: 300, y: 100 });
      const threshold = editor.localToScreen({ x: 340, y: 120 });

      editor.pointerDown(down.x, down.y);
      editor.pointerMove(threshold.x, threshold.y);
      expect(editor.openContour?.segments()[0]?.type).toBe("cubic");

      editor.escape();

      expect(editor.openContour?.points).toHaveLength(1);
      expect(editor.openContour?.segments()).toHaveLength(0);
    });

    it("places an untouched corner control one third toward the new anchor", async () => {
      await editor.clickLocal(100, 100);

      await editor.dragLocal({
        down: { x: 300, y: 100 },
        start: { x: 340, y: 120 },
        end: { x: 380, y: 180 },
      });

      const contour = editor.openContour;
      const controlStart = contour?.segments()[0]?.asCubic()?.controlStart;
      expect(controlStart?.x).toBeCloseTo(100 + (300 - 100) / 3);
      expect(controlStart?.y).toBeCloseTo(100);
      expect(contour?.lastPoint?.isOnCurve).toBe(true);
    });

    it("persists the release-position incoming handle", async () => {
      await editor.clickLocal(100, 100);

      await editor.dragLocal({
        down: { x: 300, y: 100 },
        start: { x: 340, y: 120 },
        end: { x: 380, y: 180 },
      });

      const controlEnd = editor.openContour?.segments()[0]?.asCubic()?.controlEnd;
      expect(controlEnd?.x).toBeCloseTo(220);
      expect(controlEnd?.y).toBeCloseTo(20);
    });

    it("preserves a dragged junction's outgoing handle in the next cubic", async () => {
      await editor.clickLocal(100, 100);
      await editor.dragLocal({
        down: { x: 300, y: 100 },
        start: { x: 340, y: 120 },
        end: { x: 380, y: 180 },
      });
      await editor.dragLocal({
        down: { x: 500, y: 100 },
        start: { x: 540, y: 120 },
        end: { x: 580, y: 180 },
      });

      const controlStart = editor.openContour?.segments()[1]?.asCubic()?.controlStart;
      expect(controlStart?.x).toBeCloseTo(380);
      expect(controlStart?.y).toBeCloseTo(180);
    });

    it("preserves consecutive handles before previous workspace echoes settle", async () => {
      const point = editor.clickLocal(100, 100);
      const firstCurve = editor.dragLocal({
        down: { x: 300, y: 100 },
        start: { x: 340, y: 120 },
        end: { x: 380, y: 180 },
      });
      const secondCurve = editor.dragLocal({
        down: { x: 500, y: 100 },
        start: { x: 540, y: 120 },
        end: { x: 580, y: 180 },
      });
      await Promise.all([point, firstCurve, secondCurve]);

      const controlStart = editor.openContour?.segments()[1]?.asCubic()?.controlStart;
      expect(controlStart?.x).toBeCloseTo(380);
      expect(controlStart?.y).toBeCloseTo(180);
    });

    it("keeps an active consecutive curve visible across the previous workspace echo", async () => {
      await editor.clickLocal(100, 100);

      const previousCurve = editor.dragLocal({
        down: { x: 300, y: 100 },
        start: { x: 340, y: 120 },
        end: { x: 380, y: 180 },
      });

      const down = editor.localToScreen({ x: 500, y: 100 });
      const threshold = editor.localToScreen({ x: 540, y: 120 });
      const end = editor.localToScreen({ x: 580, y: 180 });
      editor.pointerDown(down.x, down.y);
      editor.pointerMove(threshold.x, threshold.y);
      editor.pointerMove(end.x, end.y);

      await previousCurve;

      expect(editor.openContour?.segments().map((segment) => segment.type)).toEqual([
        "cubic",
        "cubic",
      ]);

      editor.escape();
      editor.pointerUp(end.x, end.y);

      expect(editor.openContour?.segments().map((segment) => segment.type)).toEqual(["cubic"]);
      expect(editor.openContour?.segments()[0]?.asCubic()?.end.smooth).toBe(false);
    });

    it("two consecutive curve drags create two cubic segments joined by a smooth point", async () => {
      await editor.click(100, 100);

      editor.pointerDown(300, 100);
      editor.pointerMove(380, 140);
      editor.pointerMove(380, 160);
      editor.pointerMove(380, 180);
      editor.pointerUp(380, 180);
      await editor.settle();

      editor.pointerDown(500, 100);
      editor.pointerMove(580, 140);
      editor.pointerMove(580, 160);
      editor.pointerMove(580, 180);

      const previewContour = editor.openContour;
      expect(previewContour?.segments().map((segment) => segment.type)).toEqual(["cubic", "cubic"]);
      expect(previewContour?.segments()[0]?.asCubic()?.end.smooth).toBe(true);
      expect(previewContour?.segments()[1]?.asCubic()?.end.smooth).toBe(false);

      editor.pointerUp(580, 180);
      await editor.settle();

      const contour = editor.openContour;
      expect(contour?.segments().map((segment) => segment.type)).toEqual(["cubic", "cubic"]);

      const junction = contour?.segments()[0]?.asCubic()?.end;
      const endpoint = contour?.segments()[1]?.asCubic()?.end;
      expect(junction?.smooth).toBe(true);
      expect(endpoint?.smooth).toBe(false);
    });

    it("adding a point and then dragging off it pulls a handle for the next curve", async () => {
      await editor.clickLocal(100, 100);
      await editor.dragLocal({
        down: { x: 100, y: 100 },
        start: { x: 120, y: 120 },
        end: { x: 160, y: 180 },
      });
      expect(editor.openContour?.points).toHaveLength(1);

      await editor.dragLocal({
        down: { x: 300, y: 100 },
        start: { x: 320, y: 120 },
        end: { x: 340, y: 140 },
      });

      const cubic = editor.openContour?.segments()[0]?.asCubic();
      expect(cubic?.controlStart.x).toBeCloseTo(160);
      expect(cubic?.controlStart.y).toBeCloseTo(180);
    });

    it("keeps the curve visible when its drag preview ends", async () => {
      await editor.click(100, 100);

      const renderModel = editor.sceneGlyphRenderModel;
      if (!renderModel) throw new Error("Expected glyph render model");

      editor.pointerDown(300, 100);
      editor.pointerMove(380, 140);
      editor.pointerMove(380, 160);
      editor.pointerMove(380, 180);
      editor.pointerUp(380, 180);

      expect(renderModel.contours[0]?.contour.segments()[0]?.type).toBe("cubic");

      await editor.settle();
      expect(renderModel.contours[0]?.contour.segments()[0]?.type).toBe("cubic");
    });
  });

  describe("temporary tool continuity", () => {
    it("continues the active contour after temporarily panning with Hand", async () => {
      await editor.click(100, 200);
      await editor.click(300, 200);
      const contourId = editor.openContour?.id;

      editor.requestTemporaryTool("hand");
      editor.returnFromTemporaryTool();
      await editor.click(500, 200);

      expect(editor.glyphContours).toHaveLength(1);
      expect(editor.openContour?.id).toBe(contourId);
      expect(editor.openContour?.points).toHaveLength(3);
    });
  });

  describe("durability and undo through the workspace", () => {
    it("a click-placed point survives as one undoable ledger entry", async () => {
      await editor.click(100, 200);
      expect(editor.pointCount).toBe(1);
      const selection = editor.selection.ids;

      await editor.undo();
      expect(editor.pointCount).toBe(0);
      expect(editor.selection.ids).toEqual([]);

      await editor.redo();
      expect(editor.pointCount).toBe(1);
      expect(editor.selection.ids).toEqual(selection);
    });

    it("a curve drag appends complete topology in one undo step", async () => {
      await editor.clickLocal(100, 100);
      await editor.dragLocal({
        down: { x: 300, y: 100 },
        start: { x: 340, y: 120 },
        end: { x: 380, y: 180 },
      });

      await editor.undo();

      expect(editor.openContour?.points).toHaveLength(1);
      expect(editor.openContour?.segments()).toHaveLength(0);
    });

    it("first click groups contour + point into a single undo step", async () => {
      // The first pen click creates the contour and the point as one user operation.
      await editor.click(100, 200);
      expect(editor.pointCount).toBe(1);

      await editor.undo();

      expect(editor.pointCount).toBe(0);
      expect(editor.glyphContours.length).toBe(0);
    });
  });

  describe("pulling a handle from an open end", () => {
    it("pulls a free handle from a line's end into the next dragged curve", async () => {
      await editor.clickLocal(100, 100);
      await editor.clickLocal(300, 100);

      await editor.dragLocal({
        down: { x: 300, y: 100 },
        start: { x: 320, y: 120 },
        end: { x: 380, y: 180 },
      });
      await editor.dragLocal({
        down: { x: 500, y: 100 },
        start: { x: 520, y: 120 },
        end: { x: 540, y: 140 },
      });

      const contour = editor.openContour;
      const next = contour?.segments()[1]?.asCubic();
      expect(contour?.segments()[0]?.type).toBe("line");
      expect(next?.controlStart.x).toBeCloseTo(380);
      expect(next?.controlStart.y).toBeCloseTo(180);
      expect(next?.start.smooth).toBe(false);
    });

    it("keeps a handle pulled with Option on the line's direction", async () => {
      await editor.clickLocal(100, 100);
      await editor.clickLocal(300, 100);

      await editor.dragLocal({
        down: { x: 300, y: 100 },
        start: { x: 320, y: 120 },
        end: { x: 380, y: 160 },
        options: { altKey: true },
      });
      await editor.dragLocal({
        down: { x: 500, y: 100 },
        start: { x: 520, y: 120 },
        end: { x: 540, y: 140 },
      });

      const next = editor.openContour?.segments()[1]?.asCubic();
      expect(next?.controlStart.x).toBeCloseTo(380);
      expect(next?.controlStart.y).toBeCloseTo(100);
      expect(next?.start.smooth).toBe(true);
    });

    it("mirrors a curve's incoming handle while pulling from its end", async () => {
      await editor.clickLocal(100, 100);
      await editor.dragLocal({
        down: { x: 300, y: 100 },
        start: { x: 340, y: 120 },
        end: { x: 380, y: 180 },
      });

      await editor.dragLocal({
        down: { x: 300, y: 100 },
        start: { x: 320, y: 90 },
        end: { x: 360, y: 60 },
      });
      await editor.dragLocal({
        down: { x: 500, y: 100 },
        start: { x: 520, y: 120 },
        end: { x: 540, y: 140 },
      });

      const [first, second] = editor.openContour?.segments() ?? [];
      const incoming = first?.asCubic()?.controlEnd;
      const outgoing = second?.asCubic()?.controlStart;
      expect(incoming?.x).toBeCloseTo(240);
      expect(incoming?.y).toBeCloseTo(140);
      expect(outgoing?.x).toBeCloseTo(360);
      expect(outgoing?.y).toBeCloseTo(60);
      expect(second?.asCubic()?.start.smooth).toBe(true);
    });

    it("draws a line when clicking after pulling a handle", async () => {
      await editor.clickLocal(100, 100);
      await editor.clickLocal(300, 100);
      await editor.dragLocal({
        down: { x: 300, y: 100 },
        start: { x: 320, y: 120 },
        end: { x: 380, y: 180 },
      });
      await editor.clickLocal(500, 100);

      expect(editor.openContour?.segments()[1]?.type).toBe("line");
    });

    it("draws a line when clicking after an ordinary curve drag", async () => {
      await editor.clickLocal(100, 100);
      await editor.dragLocal({
        down: { x: 300, y: 100 },
        start: { x: 340, y: 120 },
        end: { x: 380, y: 180 },
      });
      await editor.clickLocal(500, 100);

      expect(editor.openContour?.segments()[1]?.type).toBe("line");
    });

    it("restores a curve's incoming handle when Escape cancels the pull", async () => {
      await editor.clickLocal(100, 100);
      await editor.dragLocal({
        down: { x: 300, y: 100 },
        start: { x: 340, y: 120 },
        end: { x: 380, y: 180 },
      });

      const down = editor.localToScreen({ x: 300, y: 100 });
      const start = editor.localToScreen({ x: 320, y: 90 });
      const end = editor.localToScreen({ x: 360, y: 60 });
      editor.pointerDown(down.x, down.y).pointerMove(start.x, start.y).pointerMove(end.x, end.y);
      editor.escape();
      await editor.settle();

      const incoming = editor.openContour?.segments()[0]?.asCubic()?.controlEnd;
      expect(incoming?.x).toBeCloseTo(220);
      expect(incoming?.y).toBeCloseTo(20);
    });

    it("continues another open contour from the end a handle is pulled out of", async () => {
      await editor.clickLocal(100, 100);
      await editor.clickLocal(300, 100);
      editor.escape();

      await editor.dragLocal({
        down: { x: 100, y: 100 },
        start: { x: 90, y: 120 },
        end: { x: 60, y: 160 },
      });
      await editor.dragLocal({
        down: { x: 0, y: 300 },
        start: { x: 20, y: 320 },
        end: { x: 40, y: 340 },
      });

      const contour = editor.openContour;
      const next = contour?.segments()[1]?.asCubic();
      expect(editor.glyphContours).toHaveLength(1);
      expect(next?.start.x).toBeCloseTo(100);
      expect(next?.controlStart.x).toBeCloseTo(60);
      expect(next?.controlStart.y).toBeCloseTo(160);
    });
  });

  describe("closing and joining", () => {
    it("dragging off the first point closes a line-started contour along the line's tangent", async () => {
      await editor.drawOpenContour([
        { x: 100, y: 100 },
        { x: 300, y: 100 },
        { x: 300, y: 300 },
      ]);

      await editor.dragLocal({
        down: { x: 100, y: 100 },
        start: { x: 130, y: 110 },
        end: { x: 160, y: 130 },
      });

      const contour = editor.glyphContours[0];
      expect(editor.glyphContours).toHaveLength(1);
      expect(contour?.closed).toBe(true);
      expect(contour?.points.filter((point) => point.isOnCurve)).toHaveLength(3);
      expect(contour?.firstPoint?.smooth).toBe(true);
      expect(contour?.segments()[0]?.type).toBe("line");

      const closing = contour?.segments().at(-1)?.asCubic();
      expect(closing?.controlEnd.x).toBeCloseTo(40);
      expect(closing?.controlEnd.y).toBeCloseTo(100);
      expect(editor.openContour).toBeNull();
    });

    it("dragging off the first point mirrors a curve-started contour's first handle", async () => {
      await editor.clickLocal(100, 100);
      await editor.dragLocal({
        down: { x: 300, y: 100 },
        start: { x: 340, y: 120 },
        end: { x: 380, y: 180 },
      });
      await editor.clickLocal(300, 300);

      await editor.dragLocal({
        down: { x: 100, y: 100 },
        start: { x: 100, y: 130 },
        end: { x: 100, y: 160 },
      });

      const contour = editor.glyphContours[0];
      expect(contour?.closed).toBe(true);
      expect(contour?.points.filter((point) => point.isOnCurve)).toHaveLength(3);
      expect(contour?.firstPoint?.smooth).toBe(true);

      const first = contour?.segments()[0]?.asCubic();
      const closing = contour?.segments().at(-1)?.asCubic();
      expect(first?.controlStart).toMatchObject({ x: 100, y: 160 });
      expect(closing?.controlEnd).toMatchObject({ x: 100, y: 40 });
    });

    it("Escape during a closing drag leaves the contour open and the stroke active", async () => {
      await editor.drawOpenContour([
        { x: 100, y: 100 },
        { x: 300, y: 100 },
        { x: 300, y: 300 },
      ]);
      const down = editor.localToScreen({ x: 100, y: 100 });
      const move = editor.localToScreen({ x: 160, y: 130 });

      editor.pointerDown(down.x, down.y).pointerMove(move.x, move.y);
      editor.escape();
      editor.pointerUp(move.x, move.y);
      await editor.settle();

      expect(editor.glyphContours).toHaveLength(1);
      expect(editor.glyphContours[0]?.closed).toBe(false);
      expect(editor.glyphContours[0]?.points).toHaveLength(3);
      expect(editor.openContour).not.toBeNull();
    });

    it("a closing drag is one undo step", async () => {
      await editor.drawOpenContour([
        { x: 100, y: 100 },
        { x: 300, y: 100 },
        { x: 300, y: 300 },
      ]);
      await editor.dragLocal({
        down: { x: 100, y: 100 },
        start: { x: 130, y: 110 },
        end: { x: 160, y: 130 },
      });

      await editor.undo();

      const contour = editor.glyphContours[0];
      expect(contour?.closed).toBe(false);
      expect(contour?.points).toHaveLength(3);
    });

    it("clicking another contour's end joins the two contours and ends the stroke", async () => {
      await editor.drawOpenContour([
        { x: 100, y: 100 },
        { x: 300, y: 100 },
      ]);
      editor.escape();
      await editor.clickLocal(100, 300);
      await editor.clickLocal(300, 300);

      await editor.clickLocal(300, 100);

      const contours = editor.glyphContours;
      expect(contours).toHaveLength(1);
      expect(contours[0]?.closed).toBe(false);
      expect(contours[0]?.points.map((point) => point.position)).toEqual([
        { x: 100, y: 300 },
        { x: 300, y: 300 },
        { x: 300, y: 100 },
        { x: 100, y: 100 },
      ]);

      await editor.clickLocal(500, 500);
      expect(editor.glyphContours).toHaveLength(2);
    });

    it("shows the end cursor over another contour's start while drawing", async () => {
      await editor.drawOpenContour([
        { x: 100, y: 100 },
        { x: 300, y: 100 },
      ]);
      editor.escape();
      await editor.clickLocal(100, 300);
      await editor.clickLocal(300, 300);

      const otherStart = editor.localToScreen({ x: 100, y: 100 });
      editor.pointerMove(otherStart.x, otherStart.y);

      expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "pen-end" });
    });

    it("clicking another contour's end leaves the active contour open", async () => {
      await editor.drawOpenContour([
        { x: 100, y: 100 },
        { x: 300, y: 100 },
      ]);
      editor.escape();
      await editor.clickLocal(100, 300);
      await editor.clickLocal(300, 300);

      await editor.clickLocal(100, 100);

      expect(editor.glyphContours.every((contour) => !contour.closed)).toBe(true);
    });
  });
});
