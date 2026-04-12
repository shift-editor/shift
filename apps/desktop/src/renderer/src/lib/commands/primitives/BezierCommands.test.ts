import { describe, it, expect, beforeEach } from "vitest";
import { CloseContourCommand, NudgePointsCommand, SplitSegmentCommand } from "./BezierCommands";
import { createBridge, getAllPoints, getPointCount } from "@/testing";
import type { NativeBridge } from "@/bridge";
import type { CommandContext } from "../core";
import type { LineSegment, QuadSegment, CubicSegment } from "@/types/segments";
import type { PointId } from "@shift/types";

let bridge: NativeBridge;

function ctx(): CommandContext {
  return { bridge, glyph: bridge.getEditingSnapshot() };
}

beforeEach(() => {
  bridge = createBridge();
  bridge.startEditSession({ glyphName: "A", unicode: 65 });
});

describe("CloseContourCommand", () => {
  it("should close the active contour", () => {
    bridge.addContour();
    bridge.addPoint({ x: 0, y: 0, pointType: "onCurve", smooth: false });
    const cmd = new CloseContourCommand();

    cmd.execute(ctx());

    const glyph = bridge.getEditingSnapshot()!;
    expect(glyph.contours[0]!.closed).toBe(true);
  });

  it("should not close if already closed", () => {
    bridge.addContour();
    bridge.addPoint({ x: 0, y: 0, pointType: "onCurve", smooth: false });
    bridge.closeContour();

    const cmd = new CloseContourCommand();
    cmd.execute(ctx());

    const glyph = bridge.getEditingSnapshot()!;
    expect(glyph.contours[0]!.closed).toBe(true);
  });

  it("should have the correct name", () => {
    const cmd = new CloseContourCommand();
    expect(cmd.name).toBe("Close Contour");
  });
});

describe("NudgePointsCommand", () => {
  it("should move points by the nudge delta", () => {
    bridge.addContour();
    const p1 = bridge.addPoint({ x: 10, y: 20, pointType: "onCurve", smooth: false });
    const p2 = bridge.addPoint({ x: 30, y: 40, pointType: "onCurve", smooth: false });
    const cmd = new NudgePointsCommand([p1, p2], 1, 0);

    cmd.execute(ctx());

    const points = getAllPoints(bridge.getEditingSnapshot());
    expect(points[0]!.x).toBe(11);
    expect(points[1]!.x).toBe(31);
  });

  it("should move points back on undo", () => {
    bridge.addContour();
    const p1 = bridge.addPoint({ x: 10, y: 20, pointType: "onCurve", smooth: false });
    const cmd = new NudgePointsCommand([p1], 5, -10);

    cmd.execute(ctx());
    cmd.undo(ctx());

    const points = getAllPoints(bridge.getEditingSnapshot());
    expect(points[0]!.x).toBe(10);
    expect(points[0]!.y).toBe(20);
  });

  it("should not change state with empty array", () => {
    bridge.addContour();
    bridge.addPoint({ x: 10, y: 20, pointType: "onCurve", smooth: false });
    const cmd = new NudgePointsCommand([], 5, 5);

    cmd.execute(ctx());

    const points = getAllPoints(bridge.getEditingSnapshot());
    expect(points[0]!.x).toBe(10);
    expect(points[0]!.y).toBe(20);
  });

  it("should have the correct name", () => {
    const cmd = new NudgePointsCommand([], 0, 0);
    expect(cmd.name).toBe("Nudge Points");
  });
});

describe("SplitSegmentCommand", () => {
  function makeLineSegment(p1Id: PointId, p2Id: PointId): LineSegment {
    const points = getAllPoints(bridge.getEditingSnapshot());
    const p1 = points.find((p) => p.id === p1Id)!;
    const p2 = points.find((p) => p.id === p2Id)!;

    return {
      type: "line",
      points: {
        anchor1: { id: p1.id, x: p1.x, y: p1.y, pointType: "onCurve", smooth: false },
        anchor2: { id: p2.id, x: p2.x, y: p2.y, pointType: "onCurve", smooth: false },
      },
    };
  }

  describe("line segment", () => {
    it("should insert a single on-curve point at t=0.5", () => {
      bridge.addContour();
      const p1 = bridge.addPoint({ x: 0, y: 0, pointType: "onCurve", smooth: false });
      const p2 = bridge.addPoint({ x: 100, y: 0, pointType: "onCurve", smooth: false });
      const segment = makeLineSegment(p1, p2);
      const cmd = new SplitSegmentCommand(segment, 0.5);

      const result = cmd.execute(ctx());

      expect(getPointCount(bridge.getEditingSnapshot())).toBe(3);
      expect(result).toBeTruthy();
      expect(cmd.splitPointId).toBe(result);

      const points = getAllPoints(bridge.getEditingSnapshot());
      const splitPoint = points.find((p) => p.id === result)!;
      expect(splitPoint.x).toBe(50);
      expect(splitPoint.y).toBe(0);
      expect(splitPoint.pointType).toBe("onCurve");
    });

    it("should insert point at correct position for t=0.25", () => {
      bridge.addContour();
      const p1 = bridge.addPoint({ x: 0, y: 0, pointType: "onCurve", smooth: false });
      const p2 = bridge.addPoint({ x: 100, y: 100, pointType: "onCurve", smooth: false });
      const segment = makeLineSegment(p1, p2);
      const cmd = new SplitSegmentCommand(segment, 0.25);

      cmd.execute(ctx());

      const points = getAllPoints(bridge.getEditingSnapshot());
      const splitPoint = points.find((p) => p.id === cmd.splitPointId)!;
      expect(splitPoint.x).toBe(25);
      expect(splitPoint.y).toBe(25);
    });

    it("should remove inserted point on undo", () => {
      bridge.addContour();
      const p1 = bridge.addPoint({ x: 0, y: 0, pointType: "onCurve", smooth: false });
      const p2 = bridge.addPoint({ x: 100, y: 0, pointType: "onCurve", smooth: false });
      const segment = makeLineSegment(p1, p2);
      const cmd = new SplitSegmentCommand(segment, 0.5);

      cmd.execute(ctx());
      expect(getPointCount(bridge.getEditingSnapshot())).toBe(3);

      cmd.undo(ctx());
      expect(getPointCount(bridge.getEditingSnapshot())).toBe(2);
    });
  });

  describe("quadratic segment", () => {
    it("should insert mid point and new control for quad split", () => {
      bridge.addContour();
      const p1 = bridge.addPoint({ x: 0, y: 0, pointType: "onCurve", smooth: false });
      const c1 = bridge.addPoint({ x: 50, y: 100, pointType: "offCurve", smooth: false });
      const p2 = bridge.addPoint({ x: 100, y: 0, pointType: "onCurve", smooth: false });

      const segment: QuadSegment = {
        type: "quad",
        points: {
          anchor1: { id: p1, x: 0, y: 0, pointType: "onCurve", smooth: false },
          control: { id: c1, x: 50, y: 100, pointType: "offCurve", smooth: false },
          anchor2: { id: p2, x: 100, y: 0, pointType: "onCurve", smooth: false },
        },
      };
      const cmd = new SplitSegmentCommand(segment, 0.5);

      cmd.execute(ctx());

      // Original 3 + 2 inserted = 5
      expect(getPointCount(bridge.getEditingSnapshot())).toBe(5);

      // The split point should be on-curve and smooth
      const allPoints = getAllPoints(bridge.getEditingSnapshot());
      const splitPoint = allPoints.find((p) => p.id === cmd.splitPointId)!;
      expect(splitPoint.pointType).toBe("onCurve");
      expect(splitPoint.smooth).toBe(true);
    });

    it("should restore original state on undo", () => {
      bridge.addContour();
      const p1 = bridge.addPoint({ x: 0, y: 0, pointType: "onCurve", smooth: false });
      const c1 = bridge.addPoint({ x: 50, y: 100, pointType: "offCurve", smooth: false });
      const p2 = bridge.addPoint({ x: 100, y: 0, pointType: "onCurve", smooth: false });

      const segment: QuadSegment = {
        type: "quad",
        points: {
          anchor1: { id: p1, x: 0, y: 0, pointType: "onCurve", smooth: false },
          control: { id: c1, x: 50, y: 100, pointType: "offCurve", smooth: false },
          anchor2: { id: p2, x: 100, y: 0, pointType: "onCurve", smooth: false },
        },
      };
      const cmd = new SplitSegmentCommand(segment, 0.5);

      cmd.execute(ctx());
      cmd.undo(ctx());

      expect(getPointCount(bridge.getEditingSnapshot())).toBe(3);

      // Original control should be restored to its original position
      const allPoints = getAllPoints(bridge.getEditingSnapshot());
      const control = allPoints.find((p) => p.id === c1)!;
      expect(control.x).toBe(50);
      expect(control.y).toBe(100);
    });
  });

  describe("cubic segment", () => {
    it("should insert 3 points for cubic split", () => {
      bridge.addContour();
      const p1 = bridge.addPoint({ x: 0, y: 0, pointType: "onCurve", smooth: false });
      const c1 = bridge.addPoint({ x: 25, y: 100, pointType: "offCurve", smooth: false });
      const c2 = bridge.addPoint({ x: 75, y: 100, pointType: "offCurve", smooth: false });
      const p2 = bridge.addPoint({ x: 100, y: 0, pointType: "onCurve", smooth: false });

      const segment: CubicSegment = {
        type: "cubic",
        points: {
          anchor1: { id: p1, x: 0, y: 0, pointType: "onCurve", smooth: false },
          control1: { id: c1, x: 25, y: 100, pointType: "offCurve", smooth: false },
          control2: { id: c2, x: 75, y: 100, pointType: "offCurve", smooth: false },
          anchor2: { id: p2, x: 100, y: 0, pointType: "onCurve", smooth: false },
        },
      };
      const cmd = new SplitSegmentCommand(segment, 0.5);

      const result = cmd.execute(ctx());

      // Original 4 + 3 inserted = 7
      expect(getPointCount(bridge.getEditingSnapshot())).toBe(7);
      expect(result).toBe(cmd.splitPointId);

      // The split point should be on-curve and smooth
      const allPoints = getAllPoints(bridge.getEditingSnapshot());
      const splitPoint = allPoints.find((p) => p.id === cmd.splitPointId)!;
      expect(splitPoint.pointType).toBe("onCurve");
      expect(splitPoint.smooth).toBe(true);
    });

    it("should restore both control positions on undo", () => {
      bridge.addContour();
      const p1 = bridge.addPoint({ x: 0, y: 0, pointType: "onCurve", smooth: false });
      const c1 = bridge.addPoint({ x: 25, y: 100, pointType: "offCurve", smooth: false });
      const c2 = bridge.addPoint({ x: 75, y: 100, pointType: "offCurve", smooth: false });
      const p2 = bridge.addPoint({ x: 100, y: 0, pointType: "onCurve", smooth: false });

      const segment: CubicSegment = {
        type: "cubic",
        points: {
          anchor1: { id: p1, x: 0, y: 0, pointType: "onCurve", smooth: false },
          control1: { id: c1, x: 25, y: 100, pointType: "offCurve", smooth: false },
          control2: { id: c2, x: 75, y: 100, pointType: "offCurve", smooth: false },
          anchor2: { id: p2, x: 100, y: 0, pointType: "onCurve", smooth: false },
        },
      };
      const cmd = new SplitSegmentCommand(segment, 0.5);

      cmd.execute(ctx());
      cmd.undo(ctx());

      expect(getPointCount(bridge.getEditingSnapshot())).toBe(4);

      const allPoints = getAllPoints(bridge.getEditingSnapshot());
      const control1 = allPoints.find((p) => p.id === c1)!;
      const control2 = allPoints.find((p) => p.id === c2)!;
      expect(control1.x).toBe(25);
      expect(control1.y).toBe(100);
      expect(control2.x).toBe(75);
      expect(control2.y).toBe(100);
    });
  });

  describe("redo", () => {
    it("should clear state and re-execute", () => {
      bridge.addContour();
      const p1 = bridge.addPoint({ x: 0, y: 0, pointType: "onCurve", smooth: false });
      const p2 = bridge.addPoint({ x: 100, y: 0, pointType: "onCurve", smooth: false });
      const segment = makeLineSegment(p1, p2);
      const cmd = new SplitSegmentCommand(segment, 0.5);

      cmd.execute(ctx());
      cmd.undo(ctx());
      cmd.redo(ctx());

      expect(getPointCount(bridge.getEditingSnapshot())).toBe(3);
    });
  });

  it("should have the correct name", () => {
    bridge.addContour();
    const p1 = bridge.addPoint({ x: 0, y: 0, pointType: "onCurve", smooth: false });
    const p2 = bridge.addPoint({ x: 100, y: 0, pointType: "onCurve", smooth: false });
    const segment = makeLineSegment(p1, p2);
    const cmd = new SplitSegmentCommand(segment, 0.5);
    expect(cmd.name).toBe("Split Segment");
  });
});
