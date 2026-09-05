import { describe, expect, it } from "vitest";
import { Curve, Rect } from "@shift/geo";
import { Ellipse } from "./Ellipse";
import { Rectangle } from "./Rectangle";
import { parseContourSegments } from "@shift/glyph-state";

const bounds = Rect.fromPoints({ x: 10, y: 20 }, { x: 210, y: 120 });

describe("closed shape geometry", () => {
  it("creates a rectangle as four corner anchors without repeating the first", () => {
    const points = new Rectangle().createPoints(bounds);
    expect(points.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 10, y: 20 },
      { x: 210, y: 20 },
      { x: 210, y: 120 },
      { x: 10, y: 120 },
    ]);
    expect(points.every((point) => point.pointType === "onCurve" && !point.smooth)).toBe(true);
    expect(parseContourSegments({ points, closed: true }).map((segment) => segment.type)).toEqual([
      "line",
      "line",
      "line",
      "line",
    ]);
  });

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
    expect(parseContourSegments({ points, closed: true }).map((segment) => segment.type)).toEqual([
      "cubic",
      "cubic",
      "cubic",
      "cubic",
    ]);
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
    for (const segment of parseContourSegments({ points, closed: true })) {
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
