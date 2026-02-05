import { describe, expect, it } from "vitest";
import { asPointId, type Glyph, type GlyphSnapshot } from "@shift/types";
import { SnapManager } from "./SnapManager";
import type { SnapPreferences } from "@/types/editor";

function createGlyph(
  points: Array<{ id: string; x: number; y: number; pointType: "onCurve" | "offCurve" }>,
): Glyph {
  return {
    unicode: 65,
    name: "A",
    xAdvance: 600,
    activeContourId: null,
    contours: [
      {
        id: "c1",
        closed: false,
        points: points.map((point) => ({
          id: asPointId(point.id),
          x: point.x,
          y: point.y,
          pointType: point.pointType,
          smooth: false,
        })),
      },
    ],
  };
}

describe("SnapManager", () => {
  const manager = new SnapManager();
  const allEnabled: SnapPreferences = {
    enabled: true,
    angle: true,
    axis: true,
    pointToPoint: true,
    angleIncrementDeg: 45,
    pointRadiusPx: 8,
  };

  it("uses drag-start fallback for on-curve points", () => {
    const glyph = createGlyph([
      { id: "a1", x: 10, y: 10, pointType: "onCurve" },
      { id: "a2", x: 20, y: 10, pointType: "onCurve" },
    ]);

    const reference = manager.resolveSnapReference(glyph, asPointId("a1"), { x: 99, y: 88 });
    expect(reference).toEqual({ x: 99, y: 88 });
  });

  it("uses previous anchor for first cubic control point", () => {
    const glyph = createGlyph([
      { id: "a1", x: 0, y: 0, pointType: "onCurve" },
      { id: "c1", x: 10, y: 10, pointType: "offCurve" },
      { id: "c2", x: 20, y: 10, pointType: "offCurve" },
      { id: "a2", x: 30, y: 0, pointType: "onCurve" },
    ]);

    const reference = manager.resolveSnapReference(glyph, asPointId("c1"), { x: -1, y: -1 });
    expect(reference).toEqual({ x: 0, y: 0 });
  });

  it("uses next anchor for second cubic control point", () => {
    const glyph = createGlyph([
      { id: "a1", x: 0, y: 0, pointType: "onCurve" },
      { id: "c1", x: 10, y: 10, pointType: "offCurve" },
      { id: "c2", x: 20, y: 10, pointType: "offCurve" },
      { id: "a2", x: 30, y: 0, pointType: "onCurve" },
    ]);

    const reference = manager.resolveSnapReference(glyph, asPointId("c2"), { x: -1, y: -1 });
    expect(reference).toEqual({ x: 30, y: 0 });
  });

  it("returns snapped drag point with indicator (angle snap with shiftKey)", () => {
    const glyph = createGlyph([
      { id: "a1", x: 0, y: 0, pointType: "onCurve" },
      { id: "a2", x: 200, y: 200, pointType: "onCurve" },
    ]);
    const result = manager.snapPoint({
      point: { x: 5, y: 2 },
      reference: { x: 0, y: 0 },
      shiftKey: true,
      snapshot: glyph,
      preferences: allEnabled,
      excludedPointIds: new Set([asPointId("a1")]),
      pointToPointRadius: 4,
    });

    expect(result.snappedPoint.y).toBeCloseTo(0);
    expect(result.indicator?.lines).toEqual([
      {
        from: { x: 0, y: 0 },
        to: result.snappedPoint,
      },
    ]);
  });

  it("uses point-to-point snapping when nearby (no shiftKey)", () => {
    const glyph = createGlyph([
      { id: "a1", x: 0, y: 0, pointType: "onCurve" },
      { id: "a2", x: 10, y: 10, pointType: "onCurve" },
    ]);
    const result = manager.snapPoint({
      point: { x: 9, y: 9 },
      reference: { x: 0, y: 0 },
      shiftKey: false,
      snapshot: glyph,
      preferences: allEnabled,
      excludedPointIds: new Set([asPointId("a1")]),
      pointToPointRadius: 3,
    });

    expect(result.source).toBe("pointToPoint");
    expect(result.snappedPoint).toEqual({ x: 10, y: 10 });
  });

  it("snaps to existing x and y lines when near them (no shiftKey)", () => {
    const glyph = createGlyph([
      { id: "a1", x: 100, y: 40, pointType: "onCurve" },
      { id: "a2", x: 20, y: 200, pointType: "onCurve" },
    ]);
    const result = manager.snapPoint({
      point: { x: 97, y: 198 },
      reference: { x: 0, y: 0 },
      shiftKey: false,
      snapshot: glyph,
      preferences: {
        enabled: true,
        angle: false,
        axis: true,
        pointToPoint: false,
        angleIncrementDeg: 45,
        pointRadiusPx: 8,
      },
      pointToPointRadius: 4,
    });

    expect(result.source).toBe("axis");
    expect(result.snappedPoint).toEqual({ x: 100, y: 200 });
    expect(result.indicator?.lines).toEqual([
      {
        from: { x: 100, y: 40 },
        to: { x: 100, y: 200 },
      },
      {
        from: { x: 20, y: 200 },
        to: { x: 100, y: 200 },
      },
    ]);
  });

  it("returns snapped rotation delta", () => {
    const result = manager.snapRotationDelta({
      delta: Math.PI / 14,
      previousSnappedAngle: null,
    });
    expect(result.snappedDelta).toBeCloseTo(Math.PI / 12);
  });

  describe("SnapSession", () => {
    it("creates a session that snaps points", () => {
      const glyph = createGlyph([
        { id: "a1", x: 0, y: 0, pointType: "onCurve" },
        { id: "a2", x: 100, y: 100, pointType: "onCurve" },
      ]);

      const session = manager.createSession(
        {
          anchorPointId: asPointId("a1"),
          dragStart: { x: 0, y: 0 },
          excludedPointIds: [asPointId("a1")],
        },
        () => glyph,
        () => allEnabled,
        (px) => px,
      );

      const result = session.snap({ x: 98, y: 99 }, false);
      expect(result.snappedPoint).toEqual({ x: 100, y: 100 });
      expect(result.indicator).toBeDefined();

      session.end();
    });

    it("maintains angle hysteresis within a session", () => {
      const glyph = createGlyph([{ id: "a1", x: 0, y: 0, pointType: "onCurve" }]);

      const session = manager.createSession(
        {
          anchorPointId: asPointId("a1"),
          dragStart: { x: 0, y: 0 },
          excludedPointIds: [asPointId("a1")],
        },
        () => glyph,
        () => allEnabled,
        (px) => px,
      );

      const result1 = session.snap({ x: 100, y: 5 }, true);
      expect(result1.snappedPoint.y).toBeCloseTo(0);

      const result2 = session.snap({ x: 100, y: 10 }, true);
      expect(result2.snappedPoint.y).toBeCloseTo(0);

      session.end();
    });

    it("resolves snap reference for off-curve points to anchor", () => {
      const glyph = createGlyph([
        { id: "a1", x: 0, y: 0, pointType: "onCurve" },
        { id: "c1", x: 10, y: 10, pointType: "offCurve" },
        { id: "c2", x: 20, y: 10, pointType: "offCurve" },
        { id: "a2", x: 30, y: 0, pointType: "onCurve" },
      ]);

      const session = manager.createSession(
        {
          anchorPointId: asPointId("c1"),
          dragStart: { x: 10, y: 10 },
          excludedPointIds: [asPointId("c1")],
        },
        () => glyph,
        () => allEnabled,
        (px) => px,
      );

      const result = session.snap({ x: 50, y: 1 }, true);
      expect(result.snappedPoint.y).toBeCloseTo(0);
      expect(result.indicator?.lines[0].from).toEqual({ x: 0, y: 0 });

      session.end();
    });
  });
});
