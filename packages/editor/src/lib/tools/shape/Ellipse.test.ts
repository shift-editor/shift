import { describe, expect, it } from "vitest";
import { Curve, Rect } from "@shift/geo";
import { segmentContour } from "@shift/glyph-state";
import { Ellipse } from "./Ellipse";

const bounds = Rect.fromPoints({ x: 10, y: 20 }, { x: 210, y: 120 });

describe("Ellipse", () => {
  it("creates an ellipse with four smooth extrema and eight tangent controls", () => {
    const points = new Ellipse().createPoints(bounds);
    expect(points).toHaveLength(12);
    expect(points.filter((point) => point.smooth).map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 210, y: 70 },
      { x: 110, y: 120 },
      { x: 10, y: 70 },
      { x: 110, y: 20 },
    ]);
    expect(points.filter((point) => point.pointType === "offCurve")).toHaveLength(8);
    expect(
      segmentContour({ points, closed: true }).segments.map(({ points: segment }) => segment.type),
    ).toEqual(["cubic", "cubic", "cubic", "cubic"]);
  });

  it("scales kappa handles by the radius in the handle direction", () => {
    const points = new Ellipse().createPoints(bounds);
    expect(points[1].x).toBe(210);
    expect(points[1].y - 70).toBeCloseTo(27.61423749, 7);
    expect(points[2].x - 110).toBeCloseTo(55.22847498, 7);
    expect(points[2].y).toBe(120);
    expect(points[11].x).toBe(210);
    expect(70 - points[11].y).toBeCloseTo(27.61423749, 7);
  });

  it("keeps all four cubic quarters within the standard normalized ellipse error", () => {
    const points = new Ellipse().createPoints(bounds);
    for (const { points: segment } of segmentContour({ points, closed: true }).segments) {
      if (segment.type !== "cubic") throw new Error("Expected an ellipse cubic");
      const curve = Curve.cubic(
        segment.start,
        segment.controlStart,
        segment.controlEnd,
        segment.end,
      );
      for (let i = 0; i <= 100; i++) {
        const point = Curve.pointAt(curve, i / 100);
        const radius = Math.hypot((point.x - 110) / 100, (point.y - 70) / 50);
        expect(Math.abs(radius - 1)).toBeLessThan(0.000273);
      }
    }
  });
});
