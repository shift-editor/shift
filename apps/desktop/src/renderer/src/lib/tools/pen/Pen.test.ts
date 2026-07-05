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
      editor.click(100, 200);
      await editor.settle();

      const contour = editor.openContour;
      expect(contour?.points.length).toBe(1);
    });
  });

  describe("creating segments", () => {
    it("adding two points creates a line segment", async () => {
      editor.click(100, 200);
      await editor.settle();
      editor.click(300, 200);
      await editor.settle();

      const segment = editor.openContour?.segments()[0];

      expect(segment?.type).toBe("line");
    });

    it("adding three points creates two line segments", async () => {
      editor.click(100, 200);
      await editor.settle();
      editor.click(300, 200);
      await editor.settle();
      editor.click(500, 200);
      await editor.settle();

      const contour = editor.openContour;
      expect(contour?.segments().length).toBe(2);

      expect(contour?.segments()[0]?.type).toBe("line");
      expect(contour?.segments()[1]?.type).toBe("line");
    });

    it("clicking the first point closes the contour and ends the stroke", async () => {
      editor.click(100, 200);
      await editor.settle();
      editor.click(300, 200);
      await editor.settle();
      editor.click(200, 100);
      await editor.settle();

      editor.click(100, 200); // back on the first point
      await editor.settle();

      const contour = editor.glyphContours[0];
      expect(contour?.closed).toBe(true);
      expect(contour?.points.length).toBe(3);
      expect(editor.openContour).toBeNull();
    });

    it("two consecutive curve drags create two cubic segments joined by a smooth point", async () => {
      editor.click(100, 100);
      await editor.settle();

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
      editor.pointerUp(580, 180);
      await editor.settle();

      const contour = editor.openContour;
      expect(contour?.segments().map((segment) => segment.type)).toEqual(["cubic", "cubic"]);

      const junction = contour?.segments()[0]?.asCubic()?.end;
      expect(junction?.smooth).toBe(true);
    });

    it("adding a point and then dragging should create a cubic curve", async () => {
      editor.click(200, -800);
      await editor.settle();
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
  });

  describe("durability and undo through the workspace", () => {
    it("a click-placed point survives as one undoable ledger entry", async () => {
      editor.click(100, 200);
      await editor.settle();
      expect(editor.pointCount).toBe(1);

      await editor.undoAndSettle();
      expect(editor.pointCount).toBe(0);

      await editor.redoAndSettle();
      expect(editor.pointCount).toBe(1);
    });

    it("first click groups contour + point into a single undo step", async () => {
      // The first pen click creates the contour and the point as one user operation.
      editor.click(100, 200);
      await editor.settle();
      expect(editor.pointCount).toBe(1);

      await editor.undoAndSettle();

      expect(editor.pointCount).toBe(0);
      expect(editor.glyphContours.length).toBe(0);
    });
  });
});
