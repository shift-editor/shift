import { describe, expect, it, beforeEach } from "vitest";
import { createBridge } from "@/testing";
import type { NativeBridge } from "@/bridge";
import { SnapManager } from "./SnapManager";

const metrics = {
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  capHeight: 700,
  xHeight: 500,
  lineGap: null,
  italicAngle: null,
  underlinePosition: null,
  underlineThickness: null,
};

const prefs = {
  enabled: true,
  angle: true,
  metrics: true,
  pointToPoint: true,
  pointRadiusPx: 8,
  angleIncrementDeg: 45,
};

let bridge: NativeBridge;

beforeEach(() => {
  bridge = createBridge();
  bridge.startEditSession("A");
  const glyph = bridge.$glyph.peek()!;
  glyph.addContour();
  glyph.addPointToContour(glyph.activeContourId!, {
    x: 0,
    y: 0,
    pointType: "onCurve",
    smooth: false,
  });
  glyph.addPointToContour(glyph.activeContourId!, {
    x: 100,
    y: 100,
    pointType: "onCurve",
    smooth: false,
  });
});

function createManager() {
  return new SnapManager(
    bridge.$glyph,
    () => metrics,
    () => prefs,
    (px) => px,
  );
}

describe("SnapManager", () => {
  it("snaps point to nearest point target", () => {
    const glyph = bridge.$glyph.peek()!;
    const points = glyph.allPoints;
    const p1 = points[0]!;

    const manager = createManager();
    const session = manager.createDragSession({
      anchorPointId: p1.id,
      dragStart: { x: 0, y: 0 },
      excludedPointIds: [p1.id],
    });

    const result = session.snap({ x: 98, y: 102 }, { shiftKey: false });
    expect(result.point.x).toBe(100);
    expect(result.point.y).toBe(100);
  });

  it("returns unsnapped point when out of range", () => {
    const glyph = bridge.$glyph.peek()!;
    const points = glyph.allPoints;
    const p1 = points[0]!;

    const manager = createManager();
    const session = manager.createDragSession({
      anchorPointId: p1.id,
      dragStart: { x: 0, y: 0 },
      excludedPointIds: [p1.id],
    });

    const result = session.snap({ x: 50, y: 50 }, { shiftKey: false });
    expect(result.point.x).toBe(50);
    expect(result.point.y).toBe(50);
  });

  it("creates rotate session that snaps to angle increment", () => {
    const manager = createManager();
    const session = manager.createRotateSession();
    const result = session.snap(0.78, { shiftKey: true });
    expect(result.delta).toBeCloseTo(Math.PI / 4, 5);
  });
});
