import { describe, it, expect, beforeEach } from "vitest";
import { AddPointCommand, MovePointsCommand, RemovePointsCommand } from "./PointCommands";
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

describe("MovePointsCommand", () => {
  it("should move points by the specified delta", () => {
    fontEngine.addContour();
    const p1 = fontEngine.addPoint({ x: 10, y: 20, pointType: "onCurve", smooth: false });
    const p2 = fontEngine.addPoint({ x: 30, y: 40, pointType: "onCurve", smooth: false });
    const cmd = new MovePointsCommand([p1, p2], 10, 20);

    cmd.execute(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(20);
    expect(points[0]!.y).toBe(40);
    expect(points[1]!.x).toBe(40);
    expect(points[1]!.y).toBe(60);
  });

  it("should move points back by negative delta on undo", () => {
    fontEngine.addContour();
    const p1 = fontEngine.addPoint({ x: 10, y: 20, pointType: "onCurve", smooth: false });
    const cmd = new MovePointsCommand([p1], 15, -5);

    cmd.execute(ctx());
    cmd.undo(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(10);
    expect(points[0]!.y).toBe(20);
  });

  it("should not change state with empty array", () => {
    fontEngine.addContour();
    fontEngine.addPoint({ x: 10, y: 20, pointType: "onCurve", smooth: false });
    const cmd = new MovePointsCommand([], 10, 20);

    cmd.execute(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(10);
    expect(points[0]!.y).toBe(20);
  });

  it("should redo by executing again", () => {
    fontEngine.addContour();
    const p1 = fontEngine.addPoint({ x: 10, y: 20, pointType: "onCurve", smooth: false });
    const cmd = new MovePointsCommand([p1], 5, 5);

    cmd.execute(ctx());
    cmd.undo(ctx());
    cmd.redo(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(15);
    expect(points[0]!.y).toBe(25);
  });

  it("should have the correct name", () => {
    const cmd = new MovePointsCommand([], 0, 0);
    expect(cmd.name).toBe("Move Points");
  });
});

describe("RemovePointsCommand", () => {
  it("should remove specified points", () => {
    fontEngine.addContour();
    const p1 = fontEngine.addPoint({ x: 10, y: 20, pointType: "onCurve", smooth: false });
    const p2 = fontEngine.addPoint({ x: 30, y: 40, pointType: "onCurve", smooth: false });
    const cmd = new RemovePointsCommand([p1, p2]);

    cmd.execute(ctx());

    expect(getPointCount(fontEngine.getGlyph())).toBe(0);
  });

  it("should not change state with empty array", () => {
    fontEngine.addContour();
    fontEngine.addPoint({ x: 10, y: 20, pointType: "onCurve", smooth: false });
    const cmd = new RemovePointsCommand([]);

    cmd.execute(ctx());

    expect(getPointCount(fontEngine.getGlyph())).toBe(1);
  });

  it("should restore removed point on undo", () => {
    fontEngine.addContour();
    const p1 = fontEngine.addPoint({ x: 100, y: 200, pointType: "onCurve", smooth: false });
    const cmd = new RemovePointsCommand([p1]);

    cmd.execute(ctx());
    expect(getPointCount(fontEngine.getGlyph())).toBe(0);

    cmd.undo(ctx());
    expect(getPointCount(fontEngine.getGlyph())).toBe(1);

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(100);
    expect(points[0]!.y).toBe(200);
  });

  it("should have the correct name", () => {
    const cmd = new RemovePointsCommand([]);
    expect(cmd.name).toBe("Remove Points");
  });
});
