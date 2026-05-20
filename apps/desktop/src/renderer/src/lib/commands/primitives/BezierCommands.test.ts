import { describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { CloseContourCommand, NudgePointsCommand, SplitSegmentCommand } from "./BezierCommands";
import { Segment, type CubicSegment, type QuadSegment } from "@shift/glyph-state";
import { addContour, addPoint, commandSourceFixture, contourPoints, point } from "../testUtils";

describe("CloseContourCommand", () => {
  it("closes the contour", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    addPoint(source, contourId, { x: 0, y: 0 });
    const command = new CloseContourCommand(contourId);

    command.execute(ctx);

    expect(source.contour(contourId)?.closed).toBe(true);
  });

  it("does not reopen an already closed contour on undo", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    addPoint(source, contourId, { x: 0, y: 0 });
    source.closeContour(contourId);
    const command = new CloseContourCommand(contourId);

    command.execute(ctx);
    command.undo(ctx);

    expect(source.contour(contourId)?.closed).toBe(true);
  });

  it("has the correct name", () => {
    const command = new CloseContourCommand(0 as never);
    expect(command.name).toBe("Close Contour");
  });
});

describe("NudgePointsCommand", () => {
  it("moves points by the nudge delta", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const p1 = addPoint(source, contourId, { x: 10, y: 20 });
    const p2 = addPoint(source, contourId, { x: 30, y: 40 });
    const command = new NudgePointsCommand([p1, p2], 1, 0);

    command.execute(ctx);

    expect(point(source, p1).x).toBe(11);
    expect(point(source, p2).x).toBe(31);
  });

  it("moves points back on undo", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const p1 = addPoint(source, contourId, { x: 10, y: 20 });
    const command = new NudgePointsCommand([p1], 5, -10);

    command.execute(ctx);
    command.undo(ctx);

    expect(point(source, p1)).toMatchObject({ x: 10, y: 20 });
  });

  it("does not change state with empty array", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const p1 = addPoint(source, contourId, { x: 10, y: 20 });
    const command = new NudgePointsCommand([], 5, 5);

    command.execute(ctx);

    expect(point(source, p1)).toMatchObject({ x: 10, y: 20 });
  });

  it("has the correct name", () => {
    const command = new NudgePointsCommand([], 0, 0);
    expect(command.name).toBe("Nudge Points");
  });
});

describe("SplitSegmentCommand", () => {
  function makeLineSegment(
    source: ReturnType<typeof commandSourceFixture>["source"],
    sourcePoint1: PointId,
    sourcePoint2: PointId,
  ): Segment {
    return new Segment({
      type: "line",
      points: {
        anchor1: point(source, sourcePoint1),
        anchor2: point(source, sourcePoint2),
      },
    });
  }

  function fixture() {
    const result = commandSourceFixture();
    const contourId = addContour(result.source);
    return { ...result, contourId };
  }

  describe("line segment", () => {
    it("inserts a single on-curve point at t=0.5", () => {
      const { source, ctx, contourId } = fixture();
      const p1 = addPoint(source, contourId, { x: 0, y: 0 });
      const p2 = addPoint(source, contourId, { x: 100, y: 0 });
      const command = new SplitSegmentCommand(makeLineSegment(source, p1, p2), 0.5);

      const result = command.execute(ctx);

      expect(contourPoints(source, contourId).length).toBe(3);
      expect(command.splitPointId).toBe(result);
      expect(point(source, result)).toMatchObject({ x: 50, y: 0, pointType: "onCurve" });
    });

    it("inserts point at correct position for t=0.25", () => {
      const { source, ctx, contourId } = fixture();
      const p1 = addPoint(source, contourId, { x: 0, y: 0 });
      const p2 = addPoint(source, contourId, { x: 100, y: 100 });
      const command = new SplitSegmentCommand(makeLineSegment(source, p1, p2), 0.25);

      command.execute(ctx);

      expect(point(source, command.splitPointId!)).toMatchObject({ x: 25, y: 25 });
    });

    it("removes inserted point on undo", () => {
      const { source, ctx, contourId } = fixture();
      const p1 = addPoint(source, contourId, { x: 0, y: 0 });
      const p2 = addPoint(source, contourId, { x: 100, y: 0 });
      const command = new SplitSegmentCommand(makeLineSegment(source, p1, p2), 0.5);

      command.execute(ctx);
      expect(contourPoints(source, contourId).length).toBe(3);

      command.undo(ctx);
      expect(contourPoints(source, contourId).length).toBe(2);
    });
  });

  describe("quadratic segment", () => {
    it("inserts mid point and new control for quad split", () => {
      const { source, ctx, contourId } = fixture();
      const p1 = addPoint(source, contourId, { x: 0, y: 0 });
      const c1 = addPoint(source, contourId, { x: 50, y: 100, pointType: "offCurve" });
      const p2 = addPoint(source, contourId, { x: 100, y: 0 });
      const segment: QuadSegment = {
        type: "quad",
        points: {
          anchor1: point(source, p1),
          control: point(source, c1),
          anchor2: point(source, p2),
        },
      };
      const command = new SplitSegmentCommand(new Segment(segment), 0.5);

      command.execute(ctx);

      expect(contourPoints(source, contourId).length).toBe(5);
      expect(point(source, command.splitPointId!)).toMatchObject({
        pointType: "onCurve",
        smooth: true,
      });
    });

    it("restores original state on undo", () => {
      const { source, ctx, contourId } = fixture();
      const p1 = addPoint(source, contourId, { x: 0, y: 0 });
      const c1 = addPoint(source, contourId, { x: 50, y: 100, pointType: "offCurve" });
      const p2 = addPoint(source, contourId, { x: 100, y: 0 });
      const segment: QuadSegment = {
        type: "quad",
        points: {
          anchor1: point(source, p1),
          control: point(source, c1),
          anchor2: point(source, p2),
        },
      };
      const command = new SplitSegmentCommand(new Segment(segment), 0.5);

      command.execute(ctx);
      command.undo(ctx);

      expect(contourPoints(source, contourId).length).toBe(3);
      expect(point(source, c1)).toMatchObject({ x: 50, y: 100 });
    });
  });

  describe("cubic segment", () => {
    it("inserts three points for cubic split", () => {
      const { source, ctx, contourId } = fixture();
      const p1 = addPoint(source, contourId, { x: 0, y: 0 });
      const c1 = addPoint(source, contourId, { x: 25, y: 100, pointType: "offCurve" });
      const c2 = addPoint(source, contourId, { x: 75, y: 100, pointType: "offCurve" });
      const p2 = addPoint(source, contourId, { x: 100, y: 0 });
      const segment: CubicSegment = {
        type: "cubic",
        points: {
          anchor1: point(source, p1),
          control1: point(source, c1),
          control2: point(source, c2),
          anchor2: point(source, p2),
        },
      };
      const command = new SplitSegmentCommand(new Segment(segment), 0.5);

      const result = command.execute(ctx);

      expect(contourPoints(source, contourId).length).toBe(7);
      expect(result).toBe(command.splitPointId);
      expect(point(source, command.splitPointId!)).toMatchObject({
        pointType: "onCurve",
        smooth: true,
      });
    });

    it("restores both control positions on undo", () => {
      const { source, ctx, contourId } = fixture();
      const p1 = addPoint(source, contourId, { x: 0, y: 0 });
      const c1 = addPoint(source, contourId, { x: 25, y: 100, pointType: "offCurve" });
      const c2 = addPoint(source, contourId, { x: 75, y: 100, pointType: "offCurve" });
      const p2 = addPoint(source, contourId, { x: 100, y: 0 });
      const segment: CubicSegment = {
        type: "cubic",
        points: {
          anchor1: point(source, p1),
          control1: point(source, c1),
          control2: point(source, c2),
          anchor2: point(source, p2),
        },
      };
      const command = new SplitSegmentCommand(new Segment(segment), 0.5);

      command.execute(ctx);
      command.undo(ctx);

      expect(contourPoints(source, contourId).length).toBe(4);
      expect(point(source, c1)).toMatchObject({ x: 25, y: 100 });
      expect(point(source, c2)).toMatchObject({ x: 75, y: 100 });
    });
  });

  it("clears state and re-executes on redo", () => {
    const { source, ctx, contourId } = fixture();
    const p1 = addPoint(source, contourId, { x: 0, y: 0 });
    const p2 = addPoint(source, contourId, { x: 100, y: 0 });
    const command = new SplitSegmentCommand(makeLineSegment(source, p1, p2), 0.5);

    command.execute(ctx);
    command.undo(ctx);
    command.redo(ctx);

    expect(contourPoints(source, contourId).length).toBe(3);
  });

  it("has the correct name", () => {
    const { source, contourId } = fixture();
    const p1 = addPoint(source, contourId, { x: 0, y: 0 });
    const p2 = addPoint(source, contourId, { x: 100, y: 0 });
    const command = new SplitSegmentCommand(makeLineSegment(source, p1, p2), 0.5);
    expect(command.name).toBe("Split Segment");
  });
});
