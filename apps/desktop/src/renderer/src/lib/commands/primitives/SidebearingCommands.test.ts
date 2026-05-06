import { describe, expect, it } from "vitest";
import {
  SetLeftSidebearingCommand,
  SetRightSidebearingCommand,
  SetXAdvanceCommand,
} from "./SidebearingCommands";
import { addContour, addPoint, commandSourceFixture, point } from "../testUtils";

describe("SetXAdvanceCommand", () => {
  it("sets xAdvance on execute", () => {
    const { source, ctx } = commandSourceFixture();
    const command = new SetXAdvanceCommand(500, 530);

    command.execute(ctx);

    expect(source.geometry.xAdvance).toBe(530);
  });

  it("restores xAdvance on undo", () => {
    const { source, ctx } = commandSourceFixture();
    const command = new SetXAdvanceCommand(500, 530);

    command.execute(ctx);
    command.undo(ctx);

    expect(source.geometry.xAdvance).toBe(500);
  });
});

describe("SetRightSidebearingCommand", () => {
  it("sets xAdvance on execute", () => {
    const { source, ctx } = commandSourceFixture();
    const command = new SetRightSidebearingCommand(500, 530);

    command.execute(ctx);

    expect(source.geometry.xAdvance).toBe(530);
  });

  it("restores xAdvance on undo", () => {
    const { source, ctx } = commandSourceFixture();
    const command = new SetRightSidebearingCommand(500, 530);

    command.execute(ctx);
    command.undo(ctx);

    expect(source.geometry.xAdvance).toBe(500);
  });
});

describe("SetLeftSidebearingCommand", () => {
  it("translates geometry then sets advance on execute", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const pointId = addPoint(source, contourId, { x: 100, y: 200 });
    const command = new SetLeftSidebearingCommand(500, 520, 20);

    command.execute(ctx);

    expect(source.geometry.xAdvance).toBe(520);
    expect(point(source, pointId).x).toBe(120);
  });

  it("reverts advance and translation on undo", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const pointId = addPoint(source, contourId, { x: 100, y: 200 });
    const command = new SetLeftSidebearingCommand(500, 520, 20);

    command.execute(ctx);
    command.undo(ctx);

    expect(source.geometry.xAdvance).toBe(500);
    expect(point(source, pointId).x).toBe(100);
  });

  it("reapplies translation and advance on redo", () => {
    const { source, ctx } = commandSourceFixture();
    const contourId = addContour(source);
    const pointId = addPoint(source, contourId, { x: 100, y: 200 });
    const command = new SetLeftSidebearingCommand(500, 520, 20);

    command.execute(ctx);
    command.undo(ctx);
    command.redo(ctx);

    expect(source.geometry.xAdvance).toBe(520);
    expect(point(source, pointId).x).toBe(120);
  });
});
