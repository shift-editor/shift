import { describe, expect, it } from "vitest";
import { Mat } from "@shift/geo";
import { Contour, Point } from "@shift/glyph-state";
import { asContourId, asPointId } from "@shift/types";
import { ContourPath } from "./ContourPath";

const mixedContour = new Contour(
  {
    id: asContourId("mixed"),
    closed: false,
    points: [
      { id: asPointId("p0"), pointType: "onCurve", smooth: false },
      { id: asPointId("p1"), pointType: "onCurve", smooth: false },
      { id: asPointId("p2"), pointType: "offCurve", smooth: false },
      { id: asPointId("p3"), pointType: "onCurve", smooth: false },
      { id: asPointId("p4"), pointType: "offCurve", smooth: false },
      { id: asPointId("p5"), pointType: "offCurve", smooth: false },
      { id: asPointId("p6"), pointType: "onCurve", smooth: false },
    ],
  },
  new Float64Array([0, 0, 10, 0, 15, 10, 20, 0, 25, -10, 35, 10, 40, 0]),
  0,
);

describe("contour path output", () => {
  it("shares transformed commands across SVG, Canvas, and bounds", () => {
    const path = ContourPath.fromContour(mixedContour, Mat.Translate(5, -2));

    expect(path.svgPath).toBe("M 5 -2 L 15 -2 Q 20 8 25 -2 C 30 -12 40 8 45 -2");
    expect(path.bounds?.min.x).toBe(5);
    expect(path.bounds?.min.y).toBeCloseTo(-4.886751);
    expect(path.bounds?.max).toEqual({ x: 45, y: 3 });
    expect(path.path).toBe(path.path);
  });

  it("renders uncommitted points identically to authored contour geometry", () => {
    const points = mixedContour.points.map((point) =>
      Point.create(point, point.pointType, point.smooth),
    );
    const preview = ContourPath.fromPoints(points, false);
    const authored = ContourPath.fromContour(mixedContour, Mat.Identity());

    expect(preview.commands).toEqual(authored.commands);
    expect(preview.svgPath).toBe("M 0 0 L 10 0 Q 15 10 20 0 C 25 -10 35 10 40 0");
    expect(preview.bounds).toEqual(authored.bounds);
  });

  it("closes an uncommitted cubic through its trailing controls", () => {
    const path = ContourPath.fromPoints(
      [
        Point.onCurve({ x: 0, y: 0 }),
        Point.onCurve({ x: 100, y: 0 }),
        Point.offCurve({ x: 100, y: 100 }),
        Point.offCurve({ x: 0, y: 100 }),
      ],
      true,
    );

    expect(path.svgPath).toBe("M 0 0 L 100 0 C 100 100 0 100 0 0 Z");
    expect(path.bounds?.max).toEqual({ x: 100, y: 75 });
  });

  it("represents contours without drawable segments as empty paths", () => {
    const contour = new Contour(
      {
        id: asContourId("single"),
        closed: true,
        points: [{ id: asPointId("only"), pointType: "onCurve", smooth: false }],
      },
      new Float64Array([0, 0]),
      0,
    );
    const path = ContourPath.fromContour(contour, Mat.Identity());

    expect(path.commands).toEqual([]);
    expect(path.svgPath).toBe("");
    expect(path.bounds).toBeNull();
  });
});
