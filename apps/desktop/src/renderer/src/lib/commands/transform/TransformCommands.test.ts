import { describe, it, expect } from "vitest";
import { RotatePointsCommand, ScalePointsCommand, ReflectPointsCommand } from "./TransformCommands";
import { asPointId } from "@shift/types";
import { createMockCommandContext } from "@/testing";

describe("RotatePointsCommand", () => {
  const createSnapshotWithPoints = (points: Array<{ id: string; x: number; y: number }>) => ({
    contours: [
      {
        id: "contour-1",
        points: points.map((p) => ({
          id: p.id,
          x: p.x,
          y: p.y,
          pointType: "onCurve" as const,
          smooth: false,
        })),
        closed: false,
      },
    ],
    activeContourId: "contour-1",
    name: "A",
    xAdvance: 500,
    unicode: 65,
  });

  it("should rotate points around origin", () => {
    const snapshot = createSnapshotWithPoints([{ id: "p1", x: 1, y: 0 }]);
    const ctx = createMockCommandContext(snapshot);
    const cmd = new RotatePointsCommand([asPointId("p1")], Math.PI / 2, {
      x: 0,
      y: 0,
    });

    cmd.execute(ctx);

    expect(ctx.fontEngine.editing.movePointTo).toHaveBeenCalledWith(
      "p1",
      expect.closeTo(0, 5),
      expect.closeTo(1, 5),
    );
  });

  it("should not call movePointTo with empty point array", () => {
    const ctx = createMockCommandContext();
    const cmd = new RotatePointsCommand([], Math.PI / 2, { x: 0, y: 0 });

    cmd.execute(ctx);

    expect(ctx.fontEngine.editing.movePointTo).not.toHaveBeenCalled();
  });

  it("should restore original positions on undo", () => {
    const snapshot = createSnapshotWithPoints([{ id: "p1", x: 100, y: 200 }]);
    const ctx = createMockCommandContext(snapshot);
    const cmd = new RotatePointsCommand([asPointId("p1")], Math.PI, {
      x: 0,
      y: 0,
    });

    cmd.execute(ctx);
    cmd.undo(ctx);

    expect(ctx.fontEngine.editing.movePointTo).toHaveBeenLastCalledWith("p1", 100, 200);
  });

  it("should re-apply rotation on redo", () => {
    const snapshot = createSnapshotWithPoints([{ id: "p1", x: 1, y: 0 }]);
    const ctx = createMockCommandContext(snapshot);
    const cmd = new RotatePointsCommand([asPointId("p1")], Math.PI / 2, {
      x: 0,
      y: 0,
    });

    cmd.execute(ctx);
    cmd.undo(ctx);
    cmd.redo(ctx);

    // Last call should be the rotated position again
    const calls = (ctx.fontEngine.editing.movePointTo as any).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toBe("p1");
    expect(lastCall[1]).toBeCloseTo(0, 5);
    expect(lastCall[2]).toBeCloseTo(1, 5);
  });

  it("should have the correct name", () => {
    const cmd = new RotatePointsCommand([], 0, { x: 0, y: 0 });
    expect(cmd.name).toBe("Rotate Points");
  });
});

describe("ScalePointsCommand", () => {
  const createSnapshotWithPoints = (points: Array<{ id: string; x: number; y: number }>) => ({
    contours: [
      {
        id: "contour-1",
        points: points.map((p) => ({
          id: p.id,
          x: p.x,
          y: p.y,
          pointType: "onCurve" as const,
          smooth: false,
        })),
        closed: false,
      },
    ],
    activeContourId: "contour-1",
    name: "A",
    xAdvance: 500,
    unicode: 65,
  });

  it("should scale points from origin", () => {
    const snapshot = createSnapshotWithPoints([{ id: "p1", x: 10, y: 20 }]);
    const ctx = createMockCommandContext(snapshot);
    const cmd = new ScalePointsCommand([asPointId("p1")], 2, 2, { x: 0, y: 0 });

    cmd.execute(ctx);

    expect(ctx.fontEngine.editing.movePointTo).toHaveBeenCalledWith("p1", 20, 40);
  });

  it("should scale non-uniformly", () => {
    const snapshot = createSnapshotWithPoints([{ id: "p1", x: 10, y: 20 }]);
    const ctx = createMockCommandContext(snapshot);
    const cmd = new ScalePointsCommand([asPointId("p1")], 2, 3, { x: 0, y: 0 });

    cmd.execute(ctx);

    expect(ctx.fontEngine.editing.movePointTo).toHaveBeenCalledWith("p1", 20, 60);
  });

  it("should not call movePointTo with empty point array", () => {
    const ctx = createMockCommandContext();
    const cmd = new ScalePointsCommand([], 2, 2, { x: 0, y: 0 });

    cmd.execute(ctx);

    expect(ctx.fontEngine.editing.movePointTo).not.toHaveBeenCalled();
  });

  it("should restore original positions on undo", () => {
    const snapshot = createSnapshotWithPoints([{ id: "p1", x: 100, y: 200 }]);
    const ctx = createMockCommandContext(snapshot);
    const cmd = new ScalePointsCommand([asPointId("p1")], 2, 2, { x: 0, y: 0 });

    cmd.execute(ctx);
    cmd.undo(ctx);

    expect(ctx.fontEngine.editing.movePointTo).toHaveBeenLastCalledWith("p1", 100, 200);
  });

  it("should have the correct name", () => {
    const cmd = new ScalePointsCommand([], 1, 1, { x: 0, y: 0 });
    expect(cmd.name).toBe("Scale Points");
  });
});

describe("ReflectPointsCommand", () => {
  const createSnapshotWithPoints = (points: Array<{ id: string; x: number; y: number }>) => ({
    contours: [
      {
        id: "contour-1",
        points: points.map((p) => ({
          id: p.id,
          x: p.x,
          y: p.y,
          pointType: "onCurve" as const,
          smooth: false,
        })),
        closed: false,
      },
    ],
    activeContourId: "contour-1",
    name: "A",
    xAdvance: 500,
    unicode: 65,
  });

  it("should reflect points horizontally", () => {
    const snapshot = createSnapshotWithPoints([{ id: "p1", x: 10, y: 20 }]);
    const ctx = createMockCommandContext(snapshot);
    const cmd = new ReflectPointsCommand([asPointId("p1")], "horizontal", {
      x: 0,
      y: 0,
    });

    cmd.execute(ctx);

    expect(ctx.fontEngine.editing.movePointTo).toHaveBeenCalledWith("p1", 10, -20);
  });

  it("should reflect points vertically", () => {
    const snapshot = createSnapshotWithPoints([{ id: "p1", x: 10, y: 20 }]);
    const ctx = createMockCommandContext(snapshot);
    const cmd = new ReflectPointsCommand([asPointId("p1")], "vertical", {
      x: 0,
      y: 0,
    });

    cmd.execute(ctx);

    expect(ctx.fontEngine.editing.movePointTo).toHaveBeenCalledWith("p1", -10, 20);
  });

  it("should not call movePointTo with empty point array", () => {
    const ctx = createMockCommandContext();
    const cmd = new ReflectPointsCommand([], "horizontal", { x: 0, y: 0 });

    cmd.execute(ctx);

    expect(ctx.fontEngine.editing.movePointTo).not.toHaveBeenCalled();
  });

  it("should restore original positions on undo", () => {
    const snapshot = createSnapshotWithPoints([{ id: "p1", x: 100, y: 200 }]);
    const ctx = createMockCommandContext(snapshot);
    const cmd = new ReflectPointsCommand([asPointId("p1")], "horizontal", {
      x: 0,
      y: 0,
    });

    cmd.execute(ctx);
    cmd.undo(ctx);

    expect(ctx.fontEngine.editing.movePointTo).toHaveBeenLastCalledWith("p1", 100, 200);
  });

  it("should have the correct name", () => {
    const cmd = new ReflectPointsCommand([], "horizontal", { x: 0, y: 0 });
    expect(cmd.name).toBe("Reflect Points");
  });
});
