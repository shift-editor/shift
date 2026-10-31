import { describe, expect, it } from "vitest";
import { Rect } from "@shift/geo";
import { segmentContour } from "@shift/glyph-state";
import { Rectangle } from "./Rectangle";

const bounds = Rect.fromPoints({ x: 10, y: 20 }, { x: 210, y: 120 });

describe("Rectangle", () => {
  it("creates a rectangle as four corner anchors without repeating the first", () => {
    const points = new Rectangle().createPoints(bounds);
    expect(points.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 10, y: 20 },
      { x: 210, y: 20 },
      { x: 210, y: 120 },
      { x: 10, y: 120 },
    ]);
    expect(points.every((point) => point.pointType === "onCurve" && !point.smooth)).toBe(true);
    expect(
      segmentContour({ points, closed: true }).segments.map(({ points: segment }) => segment.type),
    ).toEqual(["line", "line", "line", "line"]);
  });
});
