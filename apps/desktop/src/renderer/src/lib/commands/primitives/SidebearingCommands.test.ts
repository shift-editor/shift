import { describe, expect, it, beforeEach } from "vitest";
import {
  SetLeftSidebearingCommand,
  SetRightSidebearingCommand,
  SetXAdvanceCommand,
} from "./SidebearingCommands";
import { createFontEngine, getAllPoints } from "@/testing";
import type { FontEngine } from "@/engine";
import type { CommandContext } from "../core";

let fontEngine: FontEngine;

function ctx(): CommandContext {
  return { fontEngine, glyph: fontEngine.getGlyph() };
}

beforeEach(() => {
  fontEngine = createFontEngine();
  fontEngine.startEditSession({ glyphName: "A", unicode: 65 });
});

describe("SetXAdvanceCommand", () => {
  it("sets xAdvance on execute", () => {
    const cmd = new SetXAdvanceCommand(500, 530);

    cmd.execute(ctx());

    expect(fontEngine.getGlyph()!.xAdvance).toBe(530);
  });

  it("restores xAdvance on undo", () => {
    const cmd = new SetXAdvanceCommand(500, 530);

    cmd.execute(ctx());
    cmd.undo(ctx());

    expect(fontEngine.getGlyph()!.xAdvance).toBe(500);
  });
});

describe("SetRightSidebearingCommand", () => {
  it("sets xAdvance on execute", () => {
    const cmd = new SetRightSidebearingCommand(500, 530);

    cmd.execute(ctx());

    expect(fontEngine.getGlyph()!.xAdvance).toBe(530);
  });

  it("restores xAdvance on undo", () => {
    const cmd = new SetRightSidebearingCommand(500, 530);

    cmd.execute(ctx());
    cmd.undo(ctx());

    expect(fontEngine.getGlyph()!.xAdvance).toBe(500);
  });
});

describe("SetLeftSidebearingCommand", () => {
  it("translates geometry then sets advance on execute", () => {
    fontEngine.addContour();
    fontEngine.addPoint({ x: 100, y: 200, pointType: "onCurve", smooth: false });
    const cmd = new SetLeftSidebearingCommand(500, 520, 20);

    cmd.execute(ctx());

    expect(fontEngine.getGlyph()!.xAdvance).toBe(520);
    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(120);
  });

  it("reverts advance and translation on undo", () => {
    fontEngine.addContour();
    fontEngine.addPoint({ x: 100, y: 200, pointType: "onCurve", smooth: false });
    const cmd = new SetLeftSidebearingCommand(500, 520, 20);

    cmd.execute(ctx());
    cmd.undo(ctx());

    expect(fontEngine.getGlyph()!.xAdvance).toBe(500);
    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(100);
  });

  it("reapplies translation and advance on redo", () => {
    fontEngine.addContour();
    fontEngine.addPoint({ x: 100, y: 200, pointType: "onCurve", smooth: false });
    const cmd = new SetLeftSidebearingCommand(500, 520, 20);

    cmd.execute(ctx());
    cmd.undo(ctx());
    cmd.redo(ctx());

    expect(fontEngine.getGlyph()!.xAdvance).toBe(520);
    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(120);
  });
});
