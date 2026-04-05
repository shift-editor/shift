import { describe, it, expect, beforeEach } from "vitest";
import { RotatePointsCommand, ScalePointsCommand, ReflectPointsCommand } from "./TransformCommands";
import { createMockFontEngine, getAllPoints } from "@/testing";
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

describe("RotatePointsCommand", () => {
  it("should rotate points around origin", () => {
    fontEngine.addContour();
    const p1 = fontEngine.addPoint({ x: 1, y: 0, pointType: "onCurve", smooth: false });
    const cmd = new RotatePointsCommand([p1], Math.PI / 2, { x: 0, y: 0 });

    cmd.execute(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBeCloseTo(0, 5);
    expect(points[0]!.y).toBeCloseTo(1, 5);
  });

  it("should not change state with empty point array", () => {
    fontEngine.addContour();
    fontEngine.addPoint({ x: 1, y: 0, pointType: "onCurve", smooth: false });
    const cmd = new RotatePointsCommand([], Math.PI / 2, { x: 0, y: 0 });

    cmd.execute(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(1);
    expect(points[0]!.y).toBe(0);
  });

  it("should restore original positions on undo", () => {
    fontEngine.addContour();
    const p1 = fontEngine.addPoint({ x: 100, y: 200, pointType: "onCurve", smooth: false });
    const cmd = new RotatePointsCommand([p1], Math.PI, { x: 0, y: 0 });

    cmd.execute(ctx());
    cmd.undo(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(100);
    expect(points[0]!.y).toBe(200);
  });

  it("should re-apply rotation on redo", () => {
    fontEngine.addContour();
    const p1 = fontEngine.addPoint({ x: 1, y: 0, pointType: "onCurve", smooth: false });
    const cmd = new RotatePointsCommand([p1], Math.PI / 2, { x: 0, y: 0 });

    cmd.execute(ctx());
    cmd.undo(ctx());
    cmd.redo(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBeCloseTo(0, 5);
    expect(points[0]!.y).toBeCloseTo(1, 5);
  });

  it("should have the correct name", () => {
    const cmd = new RotatePointsCommand([], 0, { x: 0, y: 0 });
    expect(cmd.name).toBe("Rotate Points");
  });
});

describe("ScalePointsCommand", () => {
  it("should scale points from origin", () => {
    fontEngine.addContour();
    const p1 = fontEngine.addPoint({ x: 10, y: 20, pointType: "onCurve", smooth: false });
    const cmd = new ScalePointsCommand([p1], 2, 2, { x: 0, y: 0 });

    cmd.execute(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(20);
    expect(points[0]!.y).toBe(40);
  });

  it("should scale non-uniformly", () => {
    fontEngine.addContour();
    const p1 = fontEngine.addPoint({ x: 10, y: 20, pointType: "onCurve", smooth: false });
    const cmd = new ScalePointsCommand([p1], 2, 3, { x: 0, y: 0 });

    cmd.execute(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(20);
    expect(points[0]!.y).toBe(60);
  });

  it("should not change state with empty point array", () => {
    fontEngine.addContour();
    fontEngine.addPoint({ x: 10, y: 20, pointType: "onCurve", smooth: false });
    const cmd = new ScalePointsCommand([], 2, 2, { x: 0, y: 0 });

    cmd.execute(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(10);
    expect(points[0]!.y).toBe(20);
  });

  it("should restore original positions on undo", () => {
    fontEngine.addContour();
    const p1 = fontEngine.addPoint({ x: 100, y: 200, pointType: "onCurve", smooth: false });
    const cmd = new ScalePointsCommand([p1], 2, 2, { x: 0, y: 0 });

    cmd.execute(ctx());
    cmd.undo(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(100);
    expect(points[0]!.y).toBe(200);
  });

  it("should have the correct name", () => {
    const cmd = new ScalePointsCommand([], 1, 1, { x: 0, y: 0 });
    expect(cmd.name).toBe("Scale Points");
  });
});

describe("ReflectPointsCommand", () => {
  it("should reflect points horizontally", () => {
    fontEngine.addContour();
    const p1 = fontEngine.addPoint({ x: 10, y: 20, pointType: "onCurve", smooth: false });
    const cmd = new ReflectPointsCommand([p1], "horizontal", { x: 0, y: 0 });

    cmd.execute(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(10);
    expect(points[0]!.y).toBe(-20);
  });

  it("should reflect points vertically", () => {
    fontEngine.addContour();
    const p1 = fontEngine.addPoint({ x: 10, y: 20, pointType: "onCurve", smooth: false });
    const cmd = new ReflectPointsCommand([p1], "vertical", { x: 0, y: 0 });

    cmd.execute(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(-10);
    expect(points[0]!.y).toBe(20);
  });

  it("should not change state with empty point array", () => {
    fontEngine.addContour();
    fontEngine.addPoint({ x: 10, y: 20, pointType: "onCurve", smooth: false });
    const cmd = new ReflectPointsCommand([], "horizontal", { x: 0, y: 0 });

    cmd.execute(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(10);
    expect(points[0]!.y).toBe(20);
  });

  it("should restore original positions on undo", () => {
    fontEngine.addContour();
    const p1 = fontEngine.addPoint({ x: 100, y: 200, pointType: "onCurve", smooth: false });
    const cmd = new ReflectPointsCommand([p1], "horizontal", { x: 0, y: 0 });

    cmd.execute(ctx());
    cmd.undo(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(100);
    expect(points[0]!.y).toBe(200);
  });

  it("should have the correct name", () => {
    const cmd = new ReflectPointsCommand([], "horizontal", { x: 0, y: 0 });
    expect(cmd.name).toBe("Reflect Points");
  });
});
