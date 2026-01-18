import { describe, it, expect } from "vitest";
import {
  AddBezierAnchorCommand,
  CloseContourCommand,
  AddContourCommand,
  NudgePointsCommand,
} from "./BezierCommands";
import { asPointId } from "@/types/ids";
import { createMockCommandContext } from "@/testing";

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
    expect(ctx.fontEngine.editing.addPoint).toHaveBeenNthCalledWith(
      1,
      100,
      100,
      "onCurve",
      true // smooth
    );
  });

  it("should add leading control in drag direction", () => {
    const ctx = createMockCommandContext();
    const cmd = new AddBezierAnchorCommand(100, 100, 150, 120);

    cmd.execute(ctx);

    // Second call is leading control
    expect(ctx.fontEngine.editing.addPoint).toHaveBeenNthCalledWith(
      2,
      150,
      120,
      "offCurve",
      false
    );
  });

  it("should add trailing control mirrored across anchor", () => {
    const ctx = createMockCommandContext();
    // Anchor at (100, 100), leading at (150, 120)
    // Trailing should be at (50, 80) - mirrored
    const cmd = new AddBezierAnchorCommand(100, 100, 150, 120);

    cmd.execute(ctx);

    // Third call is trailing control
    expect(ctx.fontEngine.editing.addPoint).toHaveBeenNthCalledWith(
      3,
      50, // 2 * 100 - 150
      80, // 2 * 100 - 120
      "offCurve",
      false
    );
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

    expect(ctx.fontEngine.editing.movePoints).toHaveBeenCalledWith(
      pointIds,
      1,
      0
    );
  });

  it("should move points back on undo", () => {
    const ctx = createMockCommandContext();
    const pointIds = [asPointId("p1")];
    const cmd = new NudgePointsCommand(pointIds, 5, -10); // Nudge right and up

    cmd.execute(ctx);
    cmd.undo(ctx);

    expect(ctx.fontEngine.editing.movePoints).toHaveBeenLastCalledWith(
      pointIds,
      -5,
      10 // Negative of original
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
