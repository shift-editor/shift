import { describe, expect, it } from "vitest";
import { DrawRectangleCommand } from "./ShapeCommands";
import { commandSourceFixture } from "../testUtils";

describe("DrawRectangleCommand", () => {
  it("adds a closed four-point contour", () => {
    const { source, ctx } = commandSourceFixture();
    const command = new DrawRectangleCommand(rect(10, 20, 100, 50));

    const contourId = command.execute(ctx);
    const contour = source.contour(contourId);

    expect(contour?.closed).toBe(true);
    expect(contour?.points.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 70 },
      { x: 10, y: 70 },
    ]);
  });

  it("removes created points on undo", () => {
    const { source, ctx } = commandSourceFixture();
    const command = new DrawRectangleCommand(rect(0, 0, 10, 10));

    const contourId = command.execute(ctx);
    command.undo(ctx);

    expect(source.contour(contourId)?.points).toEqual([]);
  });
});

function rect(x: number, y: number, width: number, height: number) {
  return {
    x,
    y,
    width,
    height,
    left: Math.min(x, x + width),
    top: Math.min(y, y + height),
    right: Math.max(x, x + width),
    bottom: Math.max(y, y + height),
  };
}
