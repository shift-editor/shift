import { describe, it, expect } from "vitest";
import { Glyphs } from "./Glyph";
import type { Glyph, Point, Contour, PointId, ContourId } from "@shift/types";

function makePoint(id: string, x: number, y: number): Point {
  return {
    id: id as PointId,
    x,
    y,
    pointType: "onCurve",
    smooth: false,
  };
}

function makeContour(id: string, points: Point[], closed = false): Contour {
  return { id: id as ContourId, points, closed };
}

function makeGlyph(contours: Contour[]): Glyph {
  return {
    unicode: 65,
    name: "A",
    xAdvance: 500,
    contours,
    activeContourId: null,
  };
}

describe("Glyphs", () => {
  const p1 = makePoint("p1", 0, 0);
  const p2 = makePoint("p2", 100, 0);
  const p3 = makePoint("p3", 100, 100);
  const p4 = makePoint("p4", 200, 200);

  const c1 = makeContour("c1", [p1, p2, p3]);
  const c2 = makeContour("c2", [p4]);
  const glyph = makeGlyph([c1, c2]);

  describe("findPoint", () => {
    it("finds a point by ID", () => {
      const result = Glyphs.findPoint(glyph, "p2" as PointId);
      expect(result).not.toBeNull();
      expect(result!.point).toBe(p2);
      expect(result!.contour).toBe(c1);
      expect(result!.index).toBe(1);
    });

    it("returns null for unknown ID", () => {
      expect(Glyphs.findPoint(glyph, "unknown" as PointId)).toBeNull();
    });
  });

  describe("findContour", () => {
    it("finds a contour by ID", () => {
      expect(Glyphs.findContour(glyph, "c1")).toBe(c1);
    });

    it("returns undefined for unknown ID", () => {
      expect(Glyphs.findContour(glyph, "unknown")).toBeUndefined();
    });
  });

  describe("findPoints", () => {
    it("finds multiple points by IDs", () => {
      const result = Glyphs.findPoints(glyph, ["p1" as PointId, "p4" as PointId]);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(p1);
      expect(result[1]).toBe(p4);
    });

    it("returns empty for no matches", () => {
      expect(Glyphs.findPoints(glyph, ["x" as PointId])).toHaveLength(0);
    });
  });

  describe("getAllPoints", () => {
    it("returns all points across contours", () => {
      const result = Glyphs.getAllPoints(glyph);
      expect(result).toHaveLength(4);
      expect(result).toEqual([p1, p2, p3, p4]);
    });

    it("returns empty for empty glyph", () => {
      expect(Glyphs.getAllPoints(makeGlyph([]))).toHaveLength(0);
    });
  });

  describe("getPointAt", () => {
    it("finds a point within radius", () => {
      const result = Glyphs.getPointAt(glyph, { x: 1, y: 1 }, 5);
      expect(result).toBe(p1);
    });

    it("returns null when no point is close enough", () => {
      const result = Glyphs.getPointAt(glyph, { x: 50, y: 50 }, 5);
      expect(result).toBeNull();
    });

    it("returns the first matching point", () => {
      const result = Glyphs.getPointAt(glyph, { x: 99, y: 1 }, 5);
      expect(result).toBe(p2);
    });
  });
});
