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
      editor.clickGlyphLocal(100, 100);
      await editor.settle();
      const down = editor.projectSceneToScreen({ x: 300, y: 100 });
      const threshold = editor.projectSceneToScreen({ x: 340, y: 120 });
      const end = editor.projectSceneToScreen({ x: 380, y: 180 });

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
      editor.clickGlyphLocal(100, 100);
      await editor.settle();
      const down = editor.projectSceneToScreen({ x: 300, y: 100 });
      const threshold = editor.projectSceneToScreen({ x: 340, y: 120 });

      editor.pointerDown(down.x, down.y);
      editor.pointerMove(threshold.x, threshold.y);
      expect(editor.openContour?.segments()[0]?.type).toBe("cubic");

      editor.escape();

      expect(editor.openContour?.points).toHaveLength(1);
      expect(editor.openContour?.segments()).toHaveLength(0);
    });

    it("places an untouched corner control one third toward the new anchor", async () => {
      editor.clickGlyphLocal(100, 100);
      await editor.settle();

      editor.dragScene({
        down: { x: 300, y: 100 },
        threshold: { x: 340, y: 120 },
        end: { x: 380, y: 180 },
      });
      await editor.settle();

      const contour = editor.openContour;
      const controlStart = contour?.segments()[0]?.asCubic()?.controlStart;
      expect(controlStart?.x).toBeCloseTo(100 + (300 - 100) / 3);
      expect(controlStart?.y).toBeCloseTo(100);
      expect(contour?.lastPoint?.isOnCurve).toBe(true);
    });

    it("persists the release-position incoming handle", async () => {
      editor.clickGlyphLocal(100, 100);
      await editor.settle();

      editor.dragScene({
        down: { x: 300, y: 100 },
        threshold: { x: 340, y: 120 },
        end: { x: 380, y: 180 },
      });
      await editor.settle();

      const controlEnd = editor.openContour?.segments()[0]?.asCubic()?.controlEnd;
      expect(controlEnd?.x).toBeCloseTo(220);
      expect(controlEnd?.y).toBeCloseTo(20);
    });

    it("preserves a dragged junction's outgoing handle in the next cubic", async () => {
      editor.clickGlyphLocal(100, 100);
      await editor.settle();
      editor.dragScene({
        down: { x: 300, y: 100 },
        threshold: { x: 340, y: 120 },
        end: { x: 380, y: 180 },
      });
      await editor.settle();
      editor.dragScene({
        down: { x: 500, y: 100 },
        threshold: { x: 540, y: 120 },
        end: { x: 580, y: 180 },
      });
      await editor.settle();

      const controlStart = editor.openContour?.segments()[1]?.asCubic()?.controlStart;
      expect(controlStart?.x).toBeCloseTo(380);
      expect(controlStart?.y).toBeCloseTo(180);
    });

    it("preserves consecutive handles before previous workspace echoes settle", async () => {
      editor.clickGlyphLocal(100, 100);
      editor.dragScene({
        down: { x: 300, y: 100 },
        threshold: { x: 340, y: 120 },
        end: { x: 380, y: 180 },
      });
      editor.dragScene({
        down: { x: 500, y: 100 },
        threshold: { x: 540, y: 120 },
        end: { x: 580, y: 180 },
      });
      await editor.settle();

      const controlStart = editor.openContour?.segments()[1]?.asCubic()?.controlStart;
      expect(controlStart?.x).toBeCloseTo(380);
      expect(controlStart?.y).toBeCloseTo(180);
    });

    it("keeps an active consecutive curve visible across the previous workspace echo", async () => {
      editor.clickGlyphLocal(100, 100);
      await editor.settle();

      editor.dragScene({
        down: { x: 300, y: 100 },
        threshold: { x: 340, y: 120 },
        end: { x: 380, y: 180 },
      });

      const down = editor.projectSceneToScreen({ x: 500, y: 100 });
      const threshold = editor.projectSceneToScreen({ x: 540, y: 120 });
      const end = editor.projectSceneToScreen({ x: 580, y: 180 });
      editor.pointerDown(down.x, down.y);
      editor.pointerMove(threshold.x, threshold.y);
      editor.pointerMove(end.x, end.y);

      await editor.settle();

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

    it("adding a point and then dragging should create a cubic curve", async () => {
      await editor.click(200, -800);
      editor.pointerDown(200, -800);
      editor.pointerMove(400, 120);
      editor.pointerMove(400, 140);
      editor.pointerMove(400, 160);
      editor.pointerUp(200, -200);
      await editor.settle();

      const contour = editor.openContour;
      expect(contour?.segments().length).toBe(1);
      expect(contour?.segments()[0]?.type).toBe("cubic");
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
      editor.click(100, 200);
      await editor.settle();
      editor.click(300, 200);
      await editor.settle();
      const contourId = editor.openContour?.id;

      editor.requestTemporaryTool("hand");
      editor.returnFromTemporaryTool();
      editor.click(500, 200);
      await editor.settle();

      expect(editor.glyphContours).toHaveLength(1);
      expect(editor.openContour?.id).toBe(contourId);
      expect(editor.openContour?.points).toHaveLength(3);
    });
  });

  describe("durability and undo through the workspace", () => {
    it("a click-placed point survives as one undoable ledger entry", async () => {
      await editor.click(100, 200);
      expect(editor.pointCount).toBe(1);

      await editor.undo();
      expect(editor.pointCount).toBe(0);

      await editor.redo();
      expect(editor.pointCount).toBe(1);
    });

    it("a curve drag appends complete topology in one undo step", async () => {
      editor.clickGlyphLocal(100, 100);
      await editor.settle();
      editor.dragScene({
        down: { x: 300, y: 100 },
        threshold: { x: 340, y: 120 },
        end: { x: 380, y: 180 },
      });
      await editor.settle();

      await editor.undoAndSettle();

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
});
