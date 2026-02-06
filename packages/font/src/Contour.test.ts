import { describe, it, expect } from "vitest";
import { Contours } from "./Contour";
import type { Point, Contour, PointId, ContourId } from "@shift/types";

function makePoint(
  id: string,
  x: number,
  y: number,
  pointType: "onCurve" | "offCurve" = "onCurve",
): Point {
  return { id: id as PointId, x, y, pointType, smooth: false };
}

function makeContour(id: string, points: Point[], closed = false): Contour {
  return { id: id as ContourId, points, closed };
}

describe("Contours.withNeighbors", () => {
  it("yields nothing for empty contour", () => {
    const contour = makeContour("c1", []);
    const result = [...Contours.withNeighbors(contour)];
    expect(result).toHaveLength(0);
  });

  it("yields single point with null neighbors for open contour", () => {
    const p1 = makePoint("p1", 0, 0);
    const contour = makeContour("c1", [p1], false);
    const result = [...Contours.withNeighbors(contour)];

    expect(result).toHaveLength(1);
    expect(result[0].current).toBe(p1);
    expect(result[0].prev).toBeNull();
    expect(result[0].next).toBeNull();
    expect(result[0].index).toBe(0);
    expect(result[0].isFirst).toBe(true);
    expect(result[0].isLast).toBe(true);
  });

  it("yields correct neighbors for open contour", () => {
    const p1 = makePoint("p1", 0, 0);
    const p2 = makePoint("p2", 50, 50);
    const p3 = makePoint("p3", 100, 0);
    const contour = makeContour("c1", [p1, p2, p3], false);
    const result = [...Contours.withNeighbors(contour)];

    expect(result).toHaveLength(3);

    expect(result[0].current).toBe(p1);
    expect(result[0].prev).toBeNull();
    expect(result[0].next).toBe(p2);
    expect(result[0].isFirst).toBe(true);
    expect(result[0].isLast).toBe(false);

    expect(result[1].current).toBe(p2);
    expect(result[1].prev).toBe(p1);
    expect(result[1].next).toBe(p3);
    expect(result[1].isFirst).toBe(false);
    expect(result[1].isLast).toBe(false);

    expect(result[2].current).toBe(p3);
    expect(result[2].prev).toBe(p2);
    expect(result[2].next).toBeNull();
    expect(result[2].isFirst).toBe(false);
    expect(result[2].isLast).toBe(true);
  });

  it("wraps neighbors for closed contour", () => {
    const p1 = makePoint("p1", 0, 0);
    const p2 = makePoint("p2", 100, 0);
    const p3 = makePoint("p3", 50, 100);
    const contour = makeContour("c1", [p1, p2, p3], true);
    const result = [...Contours.withNeighbors(contour)];

    expect(result).toHaveLength(3);

    expect(result[0].current).toBe(p1);
    expect(result[0].prev).toBe(p3);
    expect(result[0].next).toBe(p2);

    expect(result[2].current).toBe(p3);
    expect(result[2].prev).toBe(p2);
    expect(result[2].next).toBe(p1);
  });

  it("tracks correct indices", () => {
    const points = [makePoint("p1", 0, 0), makePoint("p2", 50, 50), makePoint("p3", 100, 0)];
    const contour = makeContour("c1", points, false);
    const indices = [...Contours.withNeighbors(contour)].map((r) => r.index);
    expect(indices).toEqual([0, 1, 2]);
  });

  it("single point in closed contour wraps to itself", () => {
    const p1 = makePoint("p1", 0, 0);
    const contour = makeContour("c1", [p1], true);
    const result = [...Contours.withNeighbors(contour)];

    expect(result).toHaveLength(1);
    expect(result[0].prev).toBe(p1);
    expect(result[0].next).toBe(p1);
  });
});
