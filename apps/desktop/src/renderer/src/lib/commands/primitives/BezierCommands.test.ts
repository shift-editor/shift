import { describe, it, expect } from "vitest";
import {
  AddBezierAnchorCommand,
  CloseContourCommand,
  AddContourCommand,
  NudgePointsCommand,
  SplitSegmentCommand,
} from "./BezierCommands";
import { asPointId } from "@shift/types";
import type { PointId } from "@shift/types";
import { createMockCommandContext } from "@/testing";
import type { LineSegment, QuadSegment, CubicSegment } from "@/types/segments";

// Helper to create segment points for testing
const makeSegmentPoint = (
  id: string,
  x: number,
  y: number,
  pointType: "onCurve" | "offCurve" = "onCurve",
) => ({
  id,
  x,
  y,
  pointType,
  smooth: false,
});

describe("AddBezierAnchorCommand", () => {
  it("should add three points: anchor, leading, and trailing", () => {
    const ctx = createMockCommandContext();
    const cmd = new AddBezierAnchorCommand(100, 100, 150, 100);

    cmd.execute(ctx);

    // Should add 3 points
    expect(ctx.fontEngine.editing.addPoint).toHaveBeenCalledTimes(3);
  });

  it("should add anchor as smooth onCurve point", () => {
    const ctx = createMockCommandContext();
    const cmd = new AddBezierAnchorCommand(100, 100, 150, 100);

    cmd.execute(ctx);

    // First call is anchor
    expect(ctx.fontEngine.editing.addPoint).toHaveBeenNthCalledWith(1, {
      id: "" as PointId,
      x: 100,
      y: 100,
      pointType: "onCurve",
      smooth: true,
    });
  });

  it("should add leading control in drag direction", () => {
    const ctx = createMockCommandContext();
    const cmd = new AddBezierAnchorCommand(100, 100, 150, 120);

    cmd.execute(ctx);

    // Second call is leading control
    expect(ctx.fontEngine.editing.addPoint).toHaveBeenNthCalledWith(2, {
      id: "" as PointId,
      x: 150,
      y: 120,
      pointType: "offCurve",
      smooth: false,
    });
  });

  it("should add trailing control mirrored across anchor", () => {
    const ctx = createMockCommandContext();
    // Anchor at (100, 100), leading at (150, 120)
    // Trailing should be at (50, 80) - mirrored
    const cmd = new AddBezierAnchorCommand(100, 100, 150, 120);

    cmd.execute(ctx);

    // Third call is trailing control
    expect(ctx.fontEngine.editing.addPoint).toHaveBeenNthCalledWith(3, {
      id: "" as PointId,
      x: 50, // 2 * 100 - 150
      y: 80, // 2 * 100 - 120
      pointType: "offCurve",
      smooth: false,
    });
  });

  it("should return the anchor point ID", () => {
    const ctx = createMockCommandContext();
    const cmd = new AddBezierAnchorCommand(100, 100, 150, 100);

    const result = cmd.execute(ctx);

    expect(result).toBe("point-1"); // First point added
    expect(cmd.anchorId).toBe("point-1");
  });

  it("should store all point IDs for undo", () => {
    const ctx = createMockCommandContext();
    const cmd = new AddBezierAnchorCommand(100, 100, 150, 100);

    cmd.execute(ctx);

    expect(cmd.anchorId).toBe("point-1");
    expect(cmd.leadingId).toBe("point-2");
    expect(cmd.trailingId).toBe("point-3");
  });

  it("should remove all three points on undo", () => {
    const ctx = createMockCommandContext();
    const cmd = new AddBezierAnchorCommand(100, 100, 150, 100);

    cmd.execute(ctx);
    cmd.undo(ctx);

    expect(ctx.fontEngine.editing.removePoints).toHaveBeenCalledWith([
      "point-1",
      "point-2",
      "point-3",
    ]);
  });

  it("should have the correct name", () => {
    const cmd = new AddBezierAnchorCommand(0, 0, 10, 10);
    expect(cmd.name).toBe("Add Bezier Anchor");
  });
});

describe("CloseContourCommand", () => {
  it("should close the active contour", () => {
    const ctx = createMockCommandContext();
    const cmd = new CloseContourCommand();

    cmd.execute(ctx);

    expect(ctx.fontEngine.editing.closeContour).toHaveBeenCalled();
  });

  it("should not close if already closed", () => {
    const snapshot = {
      contours: [
        {
          id: "contour-0",
          points: [],
          closed: true, // Already closed
        },
      ],
      activeContourId: "contour-0",
    };
    const ctx = createMockCommandContext(snapshot);
    const cmd = new CloseContourCommand();

    cmd.execute(ctx);

    expect(ctx.fontEngine.editing.closeContour).not.toHaveBeenCalled();
  });

  it("should have the correct name", () => {
    const cmd = new CloseContourCommand();
    expect(cmd.name).toBe("Close Contour");
  });
});

describe("AddContourCommand", () => {
  it("should add a new contour", () => {
    const ctx = createMockCommandContext();
    const cmd = new AddContourCommand();

    const result = cmd.execute(ctx);

    expect(ctx.fontEngine.editing.addContour).toHaveBeenCalled();
    expect(result).toBe("contour-1");
  });

  it("should have the correct name", () => {
    const cmd = new AddContourCommand();
    expect(cmd.name).toBe("Add Contour");
  });
});

describe("NudgePointsCommand", () => {
  it("should move points by the nudge delta", () => {
    const ctx = createMockCommandContext();
    const pointIds = [asPointId("p1"), asPointId("p2")];
    const cmd = new NudgePointsCommand(pointIds, 1, 0); // Nudge right

    cmd.execute(ctx);

    expect(ctx.fontEngine.editing.movePoints).toHaveBeenCalledWith(pointIds, { x: 1, y: 0 });
  });

  it("should move points back on undo", () => {
    const ctx = createMockCommandContext();
    const pointIds = [asPointId("p1")];
    const cmd = new NudgePointsCommand(pointIds, 5, -10); // Nudge right and up

    cmd.execute(ctx);
    cmd.undo(ctx);

    expect(ctx.fontEngine.editing.movePoints).toHaveBeenLastCalledWith(
      pointIds,
      { x: -5, y: 10 }, // Negative of original
    );
  });

  it("should not call movePoints with empty array", () => {
    const ctx = createMockCommandContext();
    const cmd = new NudgePointsCommand([], 5, 5);

    cmd.execute(ctx);

    expect(ctx.fontEngine.editing.movePoints).not.toHaveBeenCalled();
  });

  it("should have the correct name", () => {
    const cmd = new NudgePointsCommand([], 0, 0);
    expect(cmd.name).toBe("Nudge Points");
  });
});

describe("SplitSegmentCommand", () => {
  describe("line segment", () => {
    it("should insert a single on-curve point at t=0.5", () => {
      const ctx = createMockCommandContext();
      const segment: LineSegment = {
        type: "line",
        points: {
          anchor1: makeSegmentPoint("p1", 0, 0),
          anchor2: makeSegmentPoint("p2", 100, 0),
        },
      };
      const cmd = new SplitSegmentCommand(segment, 0.5);

      const result = cmd.execute(ctx);

      // Should insert one point before anchor2
      expect(ctx.fontEngine.editing.insertPointBefore).toHaveBeenCalledTimes(1);
      expect(ctx.fontEngine.editing.insertPointBefore).toHaveBeenCalledWith("p2", {
        x: 50,
        y: 0,
        pointType: "onCurve",
        smooth: false,
      });
      expect(result).toBe("point-1");
      expect(cmd.splitPointId).toBe("point-1");
    });

    it("should insert point at correct position for t=0.25", () => {
      const ctx = createMockCommandContext();
      const segment: LineSegment = {
        type: "line",
        points: {
          anchor1: makeSegmentPoint("p1", 0, 0),
          anchor2: makeSegmentPoint("p2", 100, 100),
        },
      };
      const cmd = new SplitSegmentCommand(segment, 0.25);

      cmd.execute(ctx);

      expect(ctx.fontEngine.editing.insertPointBefore).toHaveBeenCalledWith("p2", {
        x: 25,
        y: 25,
        pointType: "onCurve",
        smooth: false,
      });
    });

    it("should remove inserted point on undo", () => {
      const ctx = createMockCommandContext();
      const segment: LineSegment = {
        type: "line",
        points: {
          anchor1: makeSegmentPoint("p1", 0, 0),
          anchor2: makeSegmentPoint("p2", 100, 0),
        },
      };
      const cmd = new SplitSegmentCommand(segment, 0.5);

      cmd.execute(ctx);
      cmd.undo(ctx);

      expect(ctx.fontEngine.editing.removePoints).toHaveBeenCalledWith(["point-1"]);
    });
  });

  describe("quadratic segment", () => {
    it("should insert mid point and new control, move existing control", () => {
      const ctx = createMockCommandContext();
      const segment: QuadSegment = {
        type: "quad",
        points: {
          anchor1: makeSegmentPoint("p1", 0, 0),
          control: makeSegmentPoint("c1", 50, 100, "offCurve"),
          anchor2: makeSegmentPoint("p2", 100, 0),
        },
      };
      const cmd = new SplitSegmentCommand(segment, 0.5);

      cmd.execute(ctx);

      // Should insert 2 points (mid and cB) before anchor2
      expect(ctx.fontEngine.editing.insertPointBefore).toHaveBeenCalledTimes(2);

      // First insertion: mid point (onCurve, smooth)
      expect(ctx.fontEngine.editing.insertPointBefore).toHaveBeenNthCalledWith(
        1,
        "p2",
        expect.objectContaining({ pointType: "onCurve", smooth: true }),
      );

      // Second insertion: cB (offCurve)
      expect(ctx.fontEngine.editing.insertPointBefore).toHaveBeenNthCalledWith(
        2,
        "p2",
        expect.objectContaining({ pointType: "offCurve", smooth: false }),
      );

      // Should move original control to cA position
      expect(ctx.fontEngine.editing.movePointTo).toHaveBeenCalledTimes(1);
      expect(ctx.fontEngine.editing.movePointTo).toHaveBeenCalledWith(
        "c1",
        expect.any(Number),
        expect.any(Number),
      );
    });

    it("should restore original control position on undo", () => {
      const ctx = createMockCommandContext();
      const segment: QuadSegment = {
        type: "quad",
        points: {
          anchor1: makeSegmentPoint("p1", 0, 0),
          control: makeSegmentPoint("c1", 50, 100, "offCurve"),
          anchor2: makeSegmentPoint("p2", 100, 0),
        },
      };
      const cmd = new SplitSegmentCommand(segment, 0.5);

      cmd.execute(ctx);
      cmd.undo(ctx);

      // Should remove inserted points
      expect(ctx.fontEngine.editing.removePoints).toHaveBeenCalledWith(["point-1", "point-2"]);

      // Should restore original control position
      expect(ctx.fontEngine.editing.movePointTo).toHaveBeenLastCalledWith(
        "c1",
        50, // original x
        100, // original y
      );
    });
  });

  describe("cubic segment", () => {
    it("should insert 3 points and move 2 existing controls", () => {
      const ctx = createMockCommandContext();
      const segment: CubicSegment = {
        type: "cubic",
        points: {
          anchor1: makeSegmentPoint("p1", 0, 0),
          control1: makeSegmentPoint("c1", 25, 100, "offCurve"),
          control2: makeSegmentPoint("c2", 75, 100, "offCurve"),
          anchor2: makeSegmentPoint("p2", 100, 0),
        },
      };
      const cmd = new SplitSegmentCommand(segment, 0.5);

      cmd.execute(ctx);

      // Should insert 3 points (c1A, mid, c0B) before control2
      expect(ctx.fontEngine.editing.insertPointBefore).toHaveBeenCalledTimes(3);

      // First insertion: c1A (offCurve) before control2
      expect(ctx.fontEngine.editing.insertPointBefore).toHaveBeenNthCalledWith(
        1,
        "c2",
        expect.objectContaining({ pointType: "offCurve", smooth: false }),
      );

      // Second insertion: mid (onCurve, smooth) before control2
      expect(ctx.fontEngine.editing.insertPointBefore).toHaveBeenNthCalledWith(
        2,
        "c2",
        expect.objectContaining({ pointType: "onCurve", smooth: true }),
      );

      // Third insertion: c0B (offCurve) before control2
      expect(ctx.fontEngine.editing.insertPointBefore).toHaveBeenNthCalledWith(
        3,
        "c2",
        expect.objectContaining({ pointType: "offCurve", smooth: false }),
      );

      // Should move both existing controls
      expect(ctx.fontEngine.editing.movePointTo).toHaveBeenCalledTimes(2);
      expect(ctx.fontEngine.editing.movePointTo).toHaveBeenCalledWith(
        "c1",
        expect.any(Number),
        expect.any(Number),
      );
      expect(ctx.fontEngine.editing.movePointTo).toHaveBeenCalledWith(
        "c2",
        expect.any(Number),
        expect.any(Number),
      );
    });

    it("should return the mid point ID as splitPointId", () => {
      const ctx = createMockCommandContext();
      const segment: CubicSegment = {
        type: "cubic",
        points: {
          anchor1: makeSegmentPoint("p1", 0, 0),
          control1: makeSegmentPoint("c1", 25, 100, "offCurve"),
          control2: makeSegmentPoint("c2", 75, 100, "offCurve"),
          anchor2: makeSegmentPoint("p2", 100, 0),
        },
      };
      const cmd = new SplitSegmentCommand(segment, 0.5);

      const result = cmd.execute(ctx);

      // Mid point is the second insertion (point-2)
      expect(result).toBe("point-2");
      expect(cmd.splitPointId).toBe("point-2");
    });

    it("should restore both control positions on undo", () => {
      const ctx = createMockCommandContext();
      const segment: CubicSegment = {
        type: "cubic",
        points: {
          anchor1: makeSegmentPoint("p1", 0, 0),
          control1: makeSegmentPoint("c1", 25, 100, "offCurve"),
          control2: makeSegmentPoint("c2", 75, 100, "offCurve"),
          anchor2: makeSegmentPoint("p2", 100, 0),
        },
      };
      const cmd = new SplitSegmentCommand(segment, 0.5);

      cmd.execute(ctx);
      cmd.undo(ctx);

      // Should remove all 3 inserted points
      expect(ctx.fontEngine.editing.removePoints).toHaveBeenCalledWith([
        "point-1",
        "point-2",
        "point-3",
      ]);

      // Should restore both original control positions (after the removePoints call)
      const movePointToCalls = (ctx.fontEngine.editing.movePointTo as any).mock.calls;
      const lastTwoCalls = movePointToCalls.slice(-2);

      // One of the last two calls should restore c1
      const c1Restored = lastTwoCalls.some(
        (call: any[]) => call[0] === "c1" && call[1] === 25 && call[2] === 100,
      );
      // One of the last two calls should restore c2
      const c2Restored = lastTwoCalls.some(
        (call: any[]) => call[0] === "c2" && call[1] === 75 && call[2] === 100,
      );

      expect(c1Restored).toBe(true);
      expect(c2Restored).toBe(true);
    });
  });

  describe("redo", () => {
    it("should clear state and re-execute", () => {
      const ctx = createMockCommandContext();
      const segment: LineSegment = {
        type: "line",
        points: {
          anchor1: makeSegmentPoint("p1", 0, 0),
          anchor2: makeSegmentPoint("p2", 100, 0),
        },
      };
      const cmd = new SplitSegmentCommand(segment, 0.5);

      cmd.execute(ctx);
      cmd.undo(ctx);
      const result = cmd.redo(ctx);

      // Should insert point again
      expect(ctx.fontEngine.editing.insertPointBefore).toHaveBeenCalledTimes(2);
      expect(result).toBe("point-2"); // New point ID after redo
    });
  });

  it("should have the correct name", () => {
    const segment: LineSegment = {
      type: "line",
      points: {
        anchor1: makeSegmentPoint("p1", 0, 0),
        anchor2: makeSegmentPoint("p2", 100, 0),
      },
    };
    const cmd = new SplitSegmentCommand(segment, 0.5);
    expect(cmd.name).toBe("Split Segment");
  });
});
