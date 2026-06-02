import { describe, it, expect, beforeEach } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

describe("Pen tool", () => {
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor();
    editor.startSession();
    editor.selectTool("pen");
  });

  describe("point creation", () => {
    it("adds a point on click", () => {
      editor.click(100, 200);

      const contour = editor.getActiveContour();
      expect(contour?.points.length).toBe(1);
    });
  });

  describe("creating segments", () => {
    it("adding two points creates a line segment", () => {
      editor.click(100, 200);
      editor.click(300, 200);

      const segment = editor.getActiveContour()?.segments()[0];

      expect(segment?.type).toBe("line");
    });

    it("adding three points creates two line segments", () => {
      editor.click(100, 200);
      editor.click(300, 200);
      editor.click(500, 200);

      const contour = editor.getActiveContour();
      expect(contour?.segments().length).toBe(2);

      const segmentOne = editor.getActiveContour()?.segments()[0];
      const segmentTwo = editor.getActiveContour()?.segments()[1];

      expect(segmentOne?.type).toBe("line");
      expect(segmentTwo?.type).toBe("line");
    });

    it("adding three points and then pointer down on the first point should close the contour and set the active contour to null", () => {});

    it("adding a pointand then dragging should create a cubic curve", () => {
      editor.click(200, -800);
      editor.pointerDown(200, -800);
      editor.pointerMove(400, 120);
      editor.pointerMove(400, 140);
      editor.pointerMove(400, 160);
      editor.pointerUp(200, -200);

      const contour = editor.getActiveContour();
      expect(contour?.segments().length).toBe(1);

      const segment = editor.getActiveContour()?.segments()[0];
      expect(segment?.type).toBe("cubic");
    });

    it("creating two cubic curves should create two cubic segments, with a smooth point at their junction", () => {});
  });

  describe("pointer down on segment when no contour is active", () => {
    it("pointer down on the last point of the segment, sets that contour as active and contour");
    it(
      "pointer down on the first point of the segment, sets that contour as active and reverses the contour",
    );
    it(
      "pointer down between the first and last point on the segment, splits the segment at that point",
    );
  });

  describe("pen cursors", () => {
    it("active cursor");
    it("continue cursor");
    it("split cursor");
  });
});
