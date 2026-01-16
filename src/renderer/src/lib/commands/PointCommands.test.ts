import { describe, it, expect, vi } from "vitest";
import { AddPointCommand, MovePointsCommand, RemovePointsCommand } from "./PointCommands";
import type { CommandContext } from "./Command";
import { asPointId } from "@/types/ids";

// Mock FontEngine editing methods
const createMockContext = (snapshot = null): CommandContext => {
  const mockEditing = {
    addPoint: vi.fn().mockReturnValue(asPointId("point-1")),
    movePoints: vi.fn().mockReturnValue([]),
    movePointTo: vi.fn(),
    removePoints: vi.fn(),
  };

  return {
    fontEngine: {
      editing: mockEditing,
    } as any,
    snapshot,
  };
};

describe("AddPointCommand", () => {
  it("should add a point at specified coordinates", () => {
    const ctx = createMockContext();
    const cmd = new AddPointCommand(100, 200, "onCurve");

    const pointId = cmd.execute(ctx);

    expect(pointId).toBe("point-1");
    expect(ctx.fontEngine.editing.addPoint).toHaveBeenCalledWith(
      100,
      200,
      "onCurve",
      false
    );
  });

  it("should add a smooth point", () => {
    const ctx = createMockContext();
    const cmd = new AddPointCommand(50, 75, "onCurve", true);

    cmd.execute(ctx);

    expect(ctx.fontEngine.editing.addPoint).toHaveBeenCalledWith(
      50,
      75,
      "onCurve",
      true
    );
  });

  it("should add an offCurve point", () => {
    const ctx = createMockContext();
    const cmd = new AddPointCommand(30, 40, "offCurve");

    cmd.execute(ctx);

    expect(ctx.fontEngine.editing.addPoint).toHaveBeenCalledWith(
      30,
      40,
      "offCurve",
      false
    );
  });

  it("should remove the point on undo", () => {
    const ctx = createMockContext();
    const cmd = new AddPointCommand(100, 200, "onCurve");

    const pointId = cmd.execute(ctx);
    cmd.undo(ctx);

    expect(ctx.fontEngine.editing.removePoints).toHaveBeenCalledWith([pointId]);
  });

  it("should have the correct name", () => {
    const cmd = new AddPointCommand(0, 0, "onCurve");
    expect(cmd.name).toBe("Add Point");
  });
});

describe("MovePointsCommand", () => {
  it("should move points by the specified delta", () => {
    const ctx = createMockContext();
    const pointIds = [asPointId("p1"), asPointId("p2")];
    const cmd = new MovePointsCommand(pointIds, 10, 20);

    cmd.execute(ctx);

    expect(ctx.fontEngine.editing.movePoints).toHaveBeenCalledWith(
      pointIds,
      10,
      20
    );
  });

  it("should move points back by negative delta on undo", () => {
    const ctx = createMockContext();
    const pointIds = [asPointId("p1")];
    const cmd = new MovePointsCommand(pointIds, 15, -5);

    cmd.execute(ctx);
    cmd.undo(ctx);

    expect(ctx.fontEngine.editing.movePoints).toHaveBeenCalledWith(
      pointIds,
      -15,
      5
    );
  });

  it("should not call movePoints with empty array", () => {
    const ctx = createMockContext();
    const cmd = new MovePointsCommand([], 10, 20);

    cmd.execute(ctx);

    expect(ctx.fontEngine.editing.movePoints).not.toHaveBeenCalled();
  });

  it("should redo by executing again", () => {
    const ctx = createMockContext();
    const pointIds = [asPointId("p1")];
    const cmd = new MovePointsCommand(pointIds, 5, 5);

    cmd.execute(ctx);
    cmd.undo(ctx);
    cmd.redo(ctx);

    // execute + redo = 2 calls with positive delta
    // undo = 1 call with negative delta
    expect(ctx.fontEngine.editing.movePoints).toHaveBeenCalledTimes(3);
    expect(ctx.fontEngine.editing.movePoints).toHaveBeenLastCalledWith(
      pointIds,
      5,
      5
    );
  });

  it("should have the correct name", () => {
    const cmd = new MovePointsCommand([], 0, 0);
    expect(cmd.name).toBe("Move Points");
  });
});

describe("RemovePointsCommand", () => {
  it("should remove specified points", () => {
    const ctx = createMockContext();
    const pointIds = [asPointId("p1"), asPointId("p2")];
    const cmd = new RemovePointsCommand(pointIds);

    cmd.execute(ctx);

    expect(ctx.fontEngine.editing.removePoints).toHaveBeenCalledWith(pointIds);
  });

  it("should not call removePoints with empty array", () => {
    const ctx = createMockContext();
    const cmd = new RemovePointsCommand([]);

    cmd.execute(ctx);

    expect(ctx.fontEngine.editing.removePoints).not.toHaveBeenCalled();
  });

  it("should store point data for undo when snapshot available", () => {
    const snapshot = {
      contours: [
        {
          id: "contour-1",
          points: [
            { id: "p1", x: 100, y: 200, pointType: "onCurve" as const, smooth: false },
            { id: "p2", x: 150, y: 250, pointType: "offCurve" as const, smooth: false },
          ],
          closed: false,
        },
      ],
      activeContourId: "contour-1",
    };
    const ctx = createMockContext(snapshot);
    const cmd = new RemovePointsCommand([asPointId("p1")]);

    cmd.execute(ctx);
    cmd.undo(ctx);

    // Should re-add the removed point
    expect(ctx.fontEngine.editing.addPoint).toHaveBeenCalledWith(
      100,
      200,
      "onCurve",
      false
    );
  });

  it("should have the correct name", () => {
    const cmd = new RemovePointsCommand([]);
    expect(cmd.name).toBe("Remove Points");
  });
});
