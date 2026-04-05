import { describe, expect, it } from "vitest";
import {
  SetLeftSidebearingCommand,
  SetRightSidebearingCommand,
  SetXAdvanceCommand,
} from "./SidebearingCommands";
import { createMockCommandContext } from "@/testing";

describe("SetXAdvanceCommand", () => {
  it("sets xAdvance on execute", () => {
    const ctx = createMockCommandContext();
    const cmd = new SetXAdvanceCommand(500, 530);

    cmd.execute(ctx);

    expect(ctx.fontEngine.setXAdvance).toHaveBeenCalledWith(530);
  });

  it("restores xAdvance on undo", () => {
    const ctx = createMockCommandContext();
    const cmd = new SetXAdvanceCommand(500, 530);

    cmd.undo(ctx);

    expect(ctx.fontEngine.setXAdvance).toHaveBeenCalledWith(500);
  });
});

describe("SetRightSidebearingCommand", () => {
  it("sets xAdvance on execute", () => {
    const ctx = createMockCommandContext();
    const cmd = new SetRightSidebearingCommand(500, 530);

    cmd.execute(ctx);

    expect(ctx.fontEngine.setXAdvance).toHaveBeenCalledWith(530);
  });

  it("restores xAdvance on undo", () => {
    const ctx = createMockCommandContext();
    const cmd = new SetRightSidebearingCommand(500, 530);

    cmd.undo(ctx);

    expect(ctx.fontEngine.setXAdvance).toHaveBeenCalledWith(500);
  });
});

describe("SetLeftSidebearingCommand", () => {
  it("translates geometry then sets advance on execute", () => {
    const ctx = createMockCommandContext();
    const cmd = new SetLeftSidebearingCommand(500, 520, 20);

    cmd.execute(ctx);

    expect(ctx.fontEngine.translateLayer).toHaveBeenNthCalledWith(1, 20, 0);
    expect(ctx.fontEngine.setXAdvance).toHaveBeenNthCalledWith(1, 520);
  });

  it("reverts advance and translation on undo", () => {
    const ctx = createMockCommandContext();
    const cmd = new SetLeftSidebearingCommand(500, 520, 20);

    cmd.undo(ctx);

    expect(ctx.fontEngine.setXAdvance).toHaveBeenNthCalledWith(1, 500);
    expect(ctx.fontEngine.translateLayer).toHaveBeenNthCalledWith(1, -20, 0);
  });

  it("reapplies translation and advance on redo", () => {
    const ctx = createMockCommandContext();
    const cmd = new SetLeftSidebearingCommand(500, 520, 20);

    cmd.redo(ctx);

    expect(ctx.fontEngine.translateLayer).toHaveBeenNthCalledWith(1, 20, 0);
    expect(ctx.fontEngine.setXAdvance).toHaveBeenNthCalledWith(1, 520);
  });
});
