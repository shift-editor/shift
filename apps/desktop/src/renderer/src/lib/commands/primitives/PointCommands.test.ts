import { describe, expect, it } from "vitest";
import type { ContourId } from "@shift/types";
import { AddPointCommand, ToggleSmoothCommand } from "./PointCommands";
import { addContour, addPoint, commandSourceFixture, contourPoints, point } from "../testUtils";

describe("AddPointCommand", () => {
  it("adds a point at specified coordinates", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const command = new AddPointCommand(100, 200, "onCurve", false, contourId);

    const pointId = command.execute(ctx);

    expect(contourPoints(source, contourId).length).toBe(1);
    expect(point(source, pointId)).toMatchObject({ x: 100, y: 200, pointType: "onCurve" });
  });

  it("adds a smooth point", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const command = new AddPointCommand(50, 75, "onCurve", true, contourId);

    const pointId = command.execute(ctx);

    expect(point(source, pointId).smooth).toBe(true);
  });

  it("adds an off-curve point", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const command = new AddPointCommand(30, 40, "offCurve", false, contourId);

    const pointId = command.execute(ctx);

    expect(point(source, pointId).pointType).toBe("offCurve");
  });

  it("removes the point on undo", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const command = new AddPointCommand(100, 200, "onCurve", false, contourId);

    command.execute(ctx);
    expect(contourPoints(source, contourId).length).toBe(1);

    command.undo(ctx);
    expect(contourPoints(source, contourId).length).toBe(0);
  });

  it("has the correct name", () => {
    const command = new AddPointCommand(0, 0, "onCurve", false, 0 as ContourId);
    expect(command.name).toBe("Add Point");
  });
});

describe("ToggleSmoothCommand", () => {
  it("toggles smooth and toggles back on undo", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const pointId = addPoint(source, contourId, { x: 100, y: 200, smooth: false });
    const command = new ToggleSmoothCommand(pointId);

    command.execute(ctx);
    expect(point(source, pointId).smooth).toBe(true);

    command.undo(ctx);
    expect(point(source, pointId).smooth).toBe(false);
  });
});
