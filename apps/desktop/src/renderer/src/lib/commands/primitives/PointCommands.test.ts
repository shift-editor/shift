import { describe, it, expect, beforeEach } from "vitest";
import { AddPointCommand } from "./PointCommands";
import { createMockFontEngine, getAllPoints, getPointCount } from "@/testing";
import type { FontEngine } from "@/engine";
import type { CommandContext } from "../core";

let fontEngine: FontEngine;

function ctx(): CommandContext {
  return { fontEngine, glyph: fontEngine.getGlyph() };
}

beforeEach(() => {
  fontEngine = createMockFontEngine();
  fontEngine.startEditSession({ glyphName: "A", unicode: 65 });
});

describe("AddPointCommand", () => {
  it("should add a point at specified coordinates", () => {
    fontEngine.addContour();
    const cmd = new AddPointCommand(100, 200, "onCurve");

    const pointId = cmd.execute(ctx());

    expect(pointId).toBeTruthy();
    expect(getPointCount(fontEngine.getGlyph())).toBe(1);

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(100);
    expect(points[0]!.y).toBe(200);
    expect(points[0]!.pointType).toBe("onCurve");
  });

  it("should add a smooth point", () => {
    fontEngine.addContour();
    const cmd = new AddPointCommand(50, 75, "onCurve", true);

    cmd.execute(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.smooth).toBe(true);
  });

  it("should add an offCurve point", () => {
    fontEngine.addContour();
    const cmd = new AddPointCommand(30, 40, "offCurve");

    cmd.execute(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.pointType).toBe("offCurve");
  });

  it("should remove the point on undo", () => {
    fontEngine.addContour();
    const cmd = new AddPointCommand(100, 200, "onCurve");

    cmd.execute(ctx());
    expect(getPointCount(fontEngine.getGlyph())).toBe(1);

    cmd.undo(ctx());
    expect(getPointCount(fontEngine.getGlyph())).toBe(0);
  });

  it("should have the correct name", () => {
    const cmd = new AddPointCommand(0, 0, "onCurve");
    expect(cmd.name).toBe("Add Point");
  });
});
