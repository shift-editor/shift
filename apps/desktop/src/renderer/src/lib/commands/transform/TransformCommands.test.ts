import { describe, expect, it } from "vitest";
import { ReflectPointsCommand, RotatePointsCommand, ScalePointsCommand } from "./TransformCommands";
import { addContour, addPoint, commandSourceFixture, point } from "../testUtils";

describe("RotatePointsCommand", () => {
  it("rotates points around origin", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const pointId = addPoint(source, contourId, { x: 1, y: 0 });
    const command = new RotatePointsCommand([pointId], Math.PI / 2, { x: 0, y: 0 });

    command.execute(ctx);

    expect(point(source, pointId).x).toBeCloseTo(0, 5);
    expect(point(source, pointId).y).toBeCloseTo(1, 5);
  });

  it("does not change state with empty point array", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const pointId = addPoint(source, contourId, { x: 1, y: 0 });
    const command = new RotatePointsCommand([], Math.PI / 2, { x: 0, y: 0 });

    command.execute(ctx);

    expect(point(source, pointId)).toMatchObject({ x: 1, y: 0 });
  });

  it("restores original positions on undo", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const pointId = addPoint(source, contourId, { x: 100, y: 200 });
    const command = new RotatePointsCommand([pointId], Math.PI, { x: 0, y: 0 });

    command.execute(ctx);
    command.undo(ctx);

    expect(point(source, pointId)).toMatchObject({ x: 100, y: 200 });
  });

  it("reapplies rotation on redo", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const pointId = addPoint(source, contourId, { x: 1, y: 0 });
    const command = new RotatePointsCommand([pointId], Math.PI / 2, { x: 0, y: 0 });

    command.execute(ctx);
    command.undo(ctx);
    command.redo(ctx);

    expect(point(source, pointId).x).toBeCloseTo(0, 5);
    expect(point(source, pointId).y).toBeCloseTo(1, 5);
  });

  it("has the correct name", () => {
    const command = new RotatePointsCommand([], 0, { x: 0, y: 0 });
    expect(command.name).toBe("Rotate Points");
  });
});

describe("ScalePointsCommand", () => {
  it("scales points from origin", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const pointId = addPoint(source, contourId, { x: 10, y: 20 });
    const command = new ScalePointsCommand([pointId], 2, 2, { x: 0, y: 0 });

    command.execute(ctx);

    expect(point(source, pointId)).toMatchObject({ x: 20, y: 40 });
  });

  it("scales non-uniformly", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const pointId = addPoint(source, contourId, { x: 10, y: 20 });
    const command = new ScalePointsCommand([pointId], 2, 3, { x: 0, y: 0 });

    command.execute(ctx);

    expect(point(source, pointId)).toMatchObject({ x: 20, y: 60 });
  });

  it("does not change state with empty point array", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const pointId = addPoint(source, contourId, { x: 10, y: 20 });
    const command = new ScalePointsCommand([], 2, 2, { x: 0, y: 0 });

    command.execute(ctx);

    expect(point(source, pointId)).toMatchObject({ x: 10, y: 20 });
  });

  it("restores original positions on undo", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const pointId = addPoint(source, contourId, { x: 100, y: 200 });
    const command = new ScalePointsCommand([pointId], 2, 2, { x: 0, y: 0 });

    command.execute(ctx);
    command.undo(ctx);

    expect(point(source, pointId)).toMatchObject({ x: 100, y: 200 });
  });

  it("has the correct name", () => {
    const command = new ScalePointsCommand([], 1, 1, { x: 0, y: 0 });
    expect(command.name).toBe("Scale Points");
  });
});

describe("ReflectPointsCommand", () => {
  it("reflects points horizontally", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const pointId = addPoint(source, contourId, { x: 10, y: 20 });
    const command = new ReflectPointsCommand([pointId], "horizontal", { x: 0, y: 0 });

    command.execute(ctx);

    expect(point(source, pointId)).toMatchObject({ x: 10, y: -20 });
  });

  it("reflects points vertically", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const pointId = addPoint(source, contourId, { x: 10, y: 20 });
    const command = new ReflectPointsCommand([pointId], "vertical", { x: 0, y: 0 });

    command.execute(ctx);

    expect(point(source, pointId)).toMatchObject({ x: -10, y: 20 });
  });

  it("does not change state with empty point array", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const pointId = addPoint(source, contourId, { x: 10, y: 20 });
    const command = new ReflectPointsCommand([], "horizontal", { x: 0, y: 0 });

    command.execute(ctx);

    expect(point(source, pointId)).toMatchObject({ x: 10, y: 20 });
  });

  it("restores original positions on undo", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const pointId = addPoint(source, contourId, { x: 100, y: 200 });
    const command = new ReflectPointsCommand([pointId], "horizontal", { x: 0, y: 0 });

    command.execute(ctx);
    command.undo(ctx);

    expect(point(source, pointId)).toMatchObject({ x: 100, y: 200 });
  });

  it("has the correct name", () => {
    const command = new ReflectPointsCommand([], "horizontal", { x: 0, y: 0 });
    expect(command.name).toBe("Reflect Points");
  });
});
