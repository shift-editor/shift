import { describe, expect, it, beforeEach } from "vitest";
import type { PointId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";

describe("GlyphLayer point movement", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    editor.clickGlyphLocal(10, 20);
    await editor.settle();
    editor.clickGlyphLocal(30, 40);
    await editor.settle();
  });

  const layer = () => editor.glyphLayer!;

  it("moves points by a delta", async () => {
    const ids = layer().allPoints.map((point) => point.id);

    layer().movePoints(ids, { x: 1, y: 0 });
    await editor.settle();

    expect(layer().allPoints.map(({ x }) => x)).toEqual([11, 31]);
  });

  it("restores both points with one ledger undo", async () => {
    const ids = layer().allPoints.map((point) => point.id);

    layer().movePoints(ids, { x: 5, y: -10 });
    await editor.settle();

    await editor.undoAndSettle();
    expect(layer().allPoints.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);
  });

  it("does not change state with an empty point list", async () => {
    layer().movePoints([], { x: 5, y: 5 });
    await editor.settle();

    expect(layer().allPoints.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);
  });
});

describe("GlyphLayer.toggleSmooth", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    editor.click(100, 200);
    await editor.settle();
  });

  const layer = () => editor.glyphLayer!;

  it("toggles a corner point smooth", async () => {
    const pointId = layer().allPoints[0]!.id;

    layer().toggleSmooth(pointId);
    await editor.settle();

    expect(layer().point(pointId)?.smooth).toBe(true);
  });

  it("toggles back through the workspace ledger on undo", async () => {
    const pointId = layer().allPoints[0]!.id;

    layer().toggleSmooth(pointId);
    await editor.settle();
    expect(layer().point(pointId)?.smooth).toBe(true);

    await editor.undoAndSettle();
    expect(layer().point(pointId)?.smooth).toBe(false);
  });
});

describe("GlyphLayer.reverseContour", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    editor.click(0, 0);
    await editor.settle();
    editor.click(100, 0);
    await editor.settle();
    editor.click(200, 0);
    await editor.settle();
  });

  const layer = () => editor.glyphLayer!;

  it("reverses the point order", async () => {
    const contour = layer().contours[0]!;
    expect(contour.points.map(({ x }) => x)).toEqual([0, 100, 200]);

    layer().reverseContour(contour.id);
    await editor.settle();

    expect(layer().contours[0]!.points.map(({ x }) => x)).toEqual([200, 100, 0]);
  });

  it("restores the original winding through ledger undo", async () => {
    layer().reverseContour(layer().contours[0]!.id);
    await editor.settle();

    await editor.undoAndSettle();
    expect(layer().contours[0]!.points.map(({ x }) => x)).toEqual([0, 100, 200]);
  });
});

describe("GlyphLayer.splitSegment", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
  });

  const layer = () => editor.glyphLayer!;

  describe("line segment", () => {
    beforeEach(async () => {
      editor.clickGlyphLocal(0, 0);
      await editor.settle();
      editor.clickGlyphLocal(100, 0);
      await editor.settle();
    });

    it("inserts a single on-curve point at t=0.5", async () => {
      const segment = layer().contours[0]!.segments()[0]!;

      const splitId = layer().splitSegment(segment.id, 0.5);
      await editor.settle();

      expect(splitId).not.toBe(null);
      expect(layer().allPoints.length).toBe(3);
      expect(layer().point(splitId!)).toMatchObject({ x: 50, y: 0, pointType: "onCurve" });
    });

    it("removes the inserted point with one ledger undo", async () => {
      const segment = layer().contours[0]!.segments()[0]!;

      layer().splitSegment(segment.id, 0.5);
      await editor.settle();
      expect(layer().allPoints.length).toBe(3);

      await editor.undoAndSettle();
      expect(layer().allPoints.length).toBe(2);
    });
  });

  it("inserts the point at the parametric position for t=0.25", async () => {
    editor.clickGlyphLocal(0, 0);
    await editor.settle();
    editor.clickGlyphLocal(100, 100);
    await editor.settle();

    const segment = layer().contours[0]!.segments()[0]!;
    const splitId = layer().splitSegment(segment.id, 0.25);
    await editor.settle();

    expect(splitId).not.toBe(null);
    expect(layer().point(splitId!)).toMatchObject({ x: 25, y: 25 });
  });

  describe("cubic segment", () => {
    let c1: PointId;
    let c2: PointId;

    beforeEach(async () => {
      const contourId = layer().addContour();
      layer().addOnCurvePoint(contourId, { x: 0, y: 0 });
      c1 = layer().addOffCurvePoint(contourId, { x: 25, y: 100 });
      c2 = layer().addOffCurvePoint(contourId, { x: 75, y: 100 });
      layer().addOnCurvePoint(contourId, { x: 100, y: 0 });
      await editor.settle();
    });

    it("inserts three points and a smooth on-curve at the split", async () => {
      const segment = layer().contours[0]!.segments()[0]!;
      expect(segment.type).toBe("cubic");

      const splitId = layer().splitSegment(segment.id, 0.5);
      await editor.settle();

      expect(splitId).not.toBe(null);
      expect(layer().allPoints.length).toBe(7);
      expect(layer().point(splitId!)).toMatchObject({ pointType: "onCurve", smooth: true });
    });

    it("restores both control positions with one ledger undo", async () => {
      const segment = layer().contours[0]!.segments()[0]!;

      layer().splitSegment(segment.id, 0.5);
      await editor.settle();
      expect(layer().allPoints.length).toBe(7);

      await editor.undoAndSettle();
      expect(layer().allPoints.length).toBe(4);
      expect(layer().point(c1)).toMatchObject({ x: 25, y: 100 });
      expect(layer().point(c2)).toMatchObject({ x: 75, y: 100 });
    });
  });
});

describe("GlyphLayer.upgradeLineToCubic", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    editor.clickGlyphLocal(0, 0);
    await editor.settle();
    editor.clickGlyphLocal(90, 30);
    await editor.settle();
  });

  const layer = () => editor.glyphLayer!;

  it("converts the line into a shape-preserving cubic", async () => {
    const segment = layer().contours[0]!.segments()[0]!;

    expect(layer().upgradeLineToCubic(segment.id)).toBe(true);
    await editor.settle();

    const cubicSegment = layer().contours[0]!.segments()[0]!;
    expect(cubicSegment.type).toBe("cubic");
    expect(layer().allPoints.length).toBe(4);

    const cubic = cubicSegment.asCubic()!;
    expect(cubic.controlStart).toMatchObject({ x: 30, y: 10 });
    expect(cubic.controlEnd).toMatchObject({ x: 60, y: 20 });
  });

  it("removes both controls with one ledger undo", async () => {
    const segment = layer().contours[0]!.segments()[0]!;

    layer().upgradeLineToCubic(segment.id);
    await editor.settle();
    expect(layer().allPoints.length).toBe(4);

    await editor.undoAndSettle();
    expect(layer().allPoints.length).toBe(2);
    expect(layer().contours[0]!.segments()[0]!.type).toBe("line");
  });
});

describe("GlyphLayer metrics", () => {
  let editor: TestEditor;
  let initialAdvance: number;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    editor.clickGlyphLocal(100, 200);
    await editor.settle();
    editor.clickGlyphLocal(150, 200);
    await editor.settle();
    initialAdvance = editor.glyphLayer!.xAdvance;
  });

  const layer = () => editor.glyphLayer!;

  describe("setXAdvance", () => {
    it("sets the advance width", async () => {
      layer().setXAdvance(530);
      await editor.settle();

      expect(layer().xAdvance).toBe(530);
    });

    it("restores the advance through ledger undo", async () => {
      layer().setXAdvance(530);
      await editor.settle();

      await editor.undoAndSettle();
      expect(layer().xAdvance).toBe(initialAdvance);
    });
  });

  describe("setRightSidebearing", () => {
    it("sets the right sidebearing by changing the advance width", async () => {
      const bounds = layer().bounds!;
      const nextRightSidebearing = layer().sidebearings.rsb! + 30;

      layer().setRightSidebearing(nextRightSidebearing);
      await editor.settle();

      expect(layer().xAdvance).toBe(bounds.max.x + nextRightSidebearing);
      expect(layer().sidebearings.rsb).toBe(nextRightSidebearing);
    });
  });

  describe("setLeftSidebearing", () => {
    it("translates geometry and preserves the right sidebearing", async () => {
      const pointId = layer().allPoints[0]!.id;
      const point = layer().point(pointId)!;
      const nextLeftSidebearing = layer().sidebearings.lsb! + 20;
      const initialRightSidebearing = layer().sidebearings.rsb;

      layer().setLeftSidebearing(nextLeftSidebearing);
      await editor.settle();

      expect(layer().xAdvance).toBe(initialAdvance + 20);
      expect(layer().point(pointId)).toMatchObject({ x: point.x + 20, y: point.y });
      expect(layer().sidebearings.rsb).toBe(initialRightSidebearing);
    });

    it("reverts translation and advance with one ledger undo", async () => {
      const pointId = layer().allPoints[0]!.id;
      const point = layer().point(pointId)!;
      const nextLeftSidebearing = layer().sidebearings.lsb! + 20;

      layer().setLeftSidebearing(nextLeftSidebearing);
      await editor.settle();

      await editor.undoAndSettle();
      expect(layer().xAdvance).toBe(initialAdvance);
      expect(layer().point(pointId)).toMatchObject({ x: point.x, y: point.y });
    });
  });
});
