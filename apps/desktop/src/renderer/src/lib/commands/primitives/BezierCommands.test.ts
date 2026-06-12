import { describe, expect, it, beforeEach } from "vitest";
import type { PointId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";
import {
  NudgePointsCommand,
  ReverseContourCommand,
  SplitSegmentCommand,
  UpgradeLineToCubicCommand,
} from "./BezierCommands";

// Restored from the WS6 behavioral inventory (git show ef037c6e^), rebuilt on
// the workspace stack: geometry is drawn through editor verbs, commands run
// through CommandRunner, and undo goes through the workspace ledger.
describe("NudgePointsCommand", () => {
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

  const source = () => editor.activeGlyphSource!;

  it("moves points by the nudge delta", async () => {
    const ids = source().allPoints.map((point) => point.id);

    editor.commands.run(new NudgePointsCommand(ids, 1, 0));
    await editor.settle();

    expect(source().allPoints.map(({ x }) => x)).toEqual([11, 31]);
  });

  it("restores both points with one ledger undo", async () => {
    const ids = source().allPoints.map((point) => point.id);

    editor.commands.run(new NudgePointsCommand(ids, 5, -10));
    await editor.settle();

    await editor.undoAndSettle();
    expect(source().allPoints.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);
  });

  it("does not change state with an empty point list", async () => {
    editor.commands.run(new NudgePointsCommand([], 5, 5));
    await editor.settle();

    expect(source().allPoints.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);
  });
});

describe("ReverseContourCommand", () => {
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

  const source = () => editor.activeGlyphSource!;

  it("reverses the point order", async () => {
    const contour = source().contours[0]!;
    expect(contour.points.map(({ x }) => x)).toEqual([0, 100, 200]);

    editor.commands.run(new ReverseContourCommand(contour.id));
    await editor.settle();

    expect(source().contours[0]!.points.map(({ x }) => x)).toEqual([200, 100, 0]);
  });

  it("restores the original winding through ledger undo", async () => {
    editor.commands.run(new ReverseContourCommand(source().contours[0]!.id));
    await editor.settle();

    await editor.undoAndSettle();
    expect(source().contours[0]!.points.map(({ x }) => x)).toEqual([0, 100, 200]);
  });
});

describe("SplitSegmentCommand", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
  });

  const source = () => editor.activeGlyphSource!;

  describe("line segment", () => {
    beforeEach(async () => {
      editor.clickGlyphLocal(0, 0);
      await editor.settle();
      editor.clickGlyphLocal(100, 0);
      await editor.settle();
    });

    it("inserts a single on-curve point at t=0.5", async () => {
      const segment = source().contours[0]!.segments()[0]!;

      const splitId = editor.commands.run(new SplitSegmentCommand(segment, 0.5));
      await editor.settle();

      expect(source().allPoints.length).toBe(3);
      expect(source().point(splitId)).toMatchObject({ x: 50, y: 0, pointType: "onCurve" });
    });

    it("removes the inserted point with one ledger undo", async () => {
      const segment = source().contours[0]!.segments()[0]!;

      editor.commands.run(new SplitSegmentCommand(segment, 0.5));
      await editor.settle();
      expect(source().allPoints.length).toBe(3);

      await editor.undoAndSettle();
      expect(source().allPoints.length).toBe(2);
    });
  });

  it("inserts the point at the parametric position for t=0.25", async () => {
    editor.clickGlyphLocal(0, 0);
    await editor.settle();
    editor.clickGlyphLocal(100, 100);
    await editor.settle();

    const segment = source().contours[0]!.segments()[0]!;
    const splitId = editor.commands.run(new SplitSegmentCommand(segment, 0.25));
    await editor.settle();

    expect(source().point(splitId)).toMatchObject({ x: 25, y: 25 });
  });

  describe("cubic segment", () => {
    let c1: PointId;
    let c2: PointId;

    beforeEach(async () => {
      const contourId = source().addContour();
      source().addOnCurvePoint(contourId, { x: 0, y: 0 });
      c1 = source().addOffCurvePoint(contourId, { x: 25, y: 100 });
      c2 = source().addOffCurvePoint(contourId, { x: 75, y: 100 });
      source().addOnCurvePoint(contourId, { x: 100, y: 0 });
      await editor.settle();
    });

    it("inserts three points and a smooth on-curve at the split", async () => {
      const segment = source().contours[0]!.segments()[0]!;
      expect(segment.type).toBe("cubic");

      const splitId = editor.commands.run(new SplitSegmentCommand(segment, 0.5));
      await editor.settle();

      expect(source().allPoints.length).toBe(7);
      expect(source().point(splitId)).toMatchObject({ pointType: "onCurve", smooth: true });
    });

    it("restores both control positions with one ledger undo", async () => {
      const segment = source().contours[0]!.segments()[0]!;

      editor.commands.run(new SplitSegmentCommand(segment, 0.5));
      await editor.settle();
      expect(source().allPoints.length).toBe(7);

      await editor.undoAndSettle();
      expect(source().allPoints.length).toBe(4);
      expect(source().point(c1)).toMatchObject({ x: 25, y: 100 });
      expect(source().point(c2)).toMatchObject({ x: 75, y: 100 });
    });
  });
});

describe("UpgradeLineToCubicCommand", () => {
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

  const source = () => editor.activeGlyphSource!;

  it("converts the line into a shape-preserving cubic", async () => {
    const line = source().contours[0]!.segments()[0]!.asLine()!;

    editor.commands.run(new UpgradeLineToCubicCommand(line));
    await editor.settle();

    const segment = source().contours[0]!.segments()[0]!;
    expect(segment.type).toBe("cubic");
    expect(source().allPoints.length).toBe(4);

    const cubic = segment.asCubic()!;
    expect(cubic.controlStart).toMatchObject({ x: 30, y: 10 });
    expect(cubic.controlEnd).toMatchObject({ x: 60, y: 20 });
  });

  it("removes both controls with one ledger undo", async () => {
    const line = source().contours[0]!.segments()[0]!.asLine()!;

    editor.commands.run(new UpgradeLineToCubicCommand(line));
    await editor.settle();
    expect(source().allPoints.length).toBe(4);

    await editor.undoAndSettle();
    expect(source().allPoints.length).toBe(2);
    expect(source().contours[0]!.segments()[0]!.type).toBe("line");
  });
});
