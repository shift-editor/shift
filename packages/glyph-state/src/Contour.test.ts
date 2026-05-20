import { describe, expect, it } from "vitest";
import { asContourId, asPointId, type ContourData } from "@shift/types";
import { Contour } from "./Contour";

function contourData(closed = false): ContourData {
  return {
    id: asContourId("c1"),
    closed,
    points: [
      { id: asPointId("p1"), pointType: "onCurve", smooth: false },
      { id: asPointId("p2"), pointType: "onCurve", smooth: false },
      { id: asPointId("p3"), pointType: "onCurve", smooth: false },
    ],
  };
}

function contour(closed = false): Contour {
  return new Contour(contourData(closed), new Float64Array([500, 0, 0, 100, 0, 50, 100]), 1);
}

describe("Contour", () => {
  it("projects point data from the flat values buffer", () => {
    const points = contour().points;

    expect(points.map((point) => [point.id, point.x, point.y])).toEqual([
      ["p1", 0, 0],
      ["p2", 100, 0],
      ["p3", 50, 100],
    ]);
  });

  it("keeps endpoint and empty state derived from point order", () => {
    const c = contour();

    expect(c.firstPoint?.id).toBe("p1");
    expect(c.lastPoint?.id).toBe("p3");
    expect(c.isEmpty).toBe(false);
  });

  it("walks neighbors with open and closed contour semantics", () => {
    const open = [...contour(false).withNeighbors()];
    const closed = [...contour(true).withNeighbors()];

    expect(open[0].prev).toBeNull();
    expect(open[2].next).toBeNull();
    expect(closed[0].prev?.id).toBe("p3");
    expect(closed[2].next?.id).toBe("p1");
  });

  it("parses segments and closed wrap-around segment", () => {
    expect(contour(false).segments()).toHaveLength(2);
    expect(contour(true).segments()).toHaveLength(3);
  });

  it("computes contour and selection bounds", () => {
    const c = contour(true);

    expect(c.bounds?.min).toEqual({ x: 0, y: 0 });
    expect(c.bounds?.max).toEqual({ x: 100, y: 100 });
    expect(c.selectionBounds(new Set([asPointId("p1"), asPointId("p2")]))?.max.x).toBe(100);
  });

  it("detects whether an open contour can close near its first point", () => {
    expect(contour(false).canClose({ x: 3, y: 4 }, 5)).toBe(true);
    expect(contour(false).canClose({ x: 20, y: 20 }, 5)).toBe(false);
    expect(contour(true).canClose({ x: 0, y: 0 }, 5)).toBe(false);
  });
});
