import { describe, it, expect } from "vitest";
import { Transform } from "./Transform";
import { Bounds } from "@shift/geo";
import { asPointId } from "@shift/types";

describe("Transform", () => {
  // Helper to create test points
  const p = (id: string, x: number, y: number) => ({
    id: asPointId(id),
    x,
    y,
  });

  describe("rotatePoints", () => {
    it("rotates points 90° counter-clockwise around origin", () => {
      const points = [p("p1", 1, 0)];
      const origin = { x: 0, y: 0 };

      const result = Transform.rotatePoints(points, Math.PI / 2, origin);

      expect(result[0].id).toBe("p1");
      expect(result[0].x).toBeCloseTo(0);
      expect(result[0].y).toBeCloseTo(1);
    });

    it("rotates points 90° clockwise around origin", () => {
      const points = [p("p1", 0, 1)];
      const origin = { x: 0, y: 0 };

      const result = Transform.rotatePoints(points, -Math.PI / 2, origin);

      expect(result[0].x).toBeCloseTo(1);
      expect(result[0].y).toBeCloseTo(0);
    });

    it("rotates points 180° around origin", () => {
      const points = [p("p1", 1, 1)];
      const origin = { x: 0, y: 0 };

      const result = Transform.rotatePoints(points, Math.PI, origin);

      expect(result[0].x).toBeCloseTo(-1);
      expect(result[0].y).toBeCloseTo(-1);
    });

    it("rotates around a custom origin", () => {
      const points = [p("p1", 2, 0)];
      const origin = { x: 1, y: 0 };

      const result = Transform.rotatePoints(points, Math.PI / 2, origin);

      expect(result[0].x).toBeCloseTo(1);
      expect(result[0].y).toBeCloseTo(1);
    });

    it("handles multiple points", () => {
      const points = [p("p1", 1, 0), p("p2", 0, 1)];
      const origin = { x: 0, y: 0 };

      const result = Transform.rotatePoints(points, Math.PI / 2, origin);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("p1");
      expect(result[1].id).toBe("p2");
    });

    it("preserves original array (immutable)", () => {
      const points = [p("p1", 1, 0)];
      const origin = { x: 0, y: 0 };

      Transform.rotatePoints(points, Math.PI / 2, origin);

      expect(points[0].x).toBe(1);
      expect(points[0].y).toBe(0);
    });
  });

  describe("scalePoints", () => {
    it("scales points uniformly from origin", () => {
      const points = [p("p1", 2, 3)];
      const origin = { x: 0, y: 0 };

      const result = Transform.scalePoints(points, 2, 2, origin);

      expect(result[0].x).toBe(4);
      expect(result[0].y).toBe(6);
    });

    it("scales points non-uniformly", () => {
      const points = [p("p1", 2, 3)];
      const origin = { x: 0, y: 0 };

      const result = Transform.scalePoints(points, 2, 3, origin);

      expect(result[0].x).toBe(4);
      expect(result[0].y).toBe(9);
    });

    it("scales from a custom origin", () => {
      const points = [p("p1", 3, 4)];
      const origin = { x: 1, y: 2 };

      const result = Transform.scalePoints(points, 2, 2, origin);

      // (3-1)*2 + 1 = 5, (4-2)*2 + 2 = 6
      expect(result[0].x).toBe(5);
      expect(result[0].y).toBe(6);
    });

    it("handles scale factor of 0.5 (shrink)", () => {
      const points = [p("p1", 4, 6)];
      const origin = { x: 0, y: 0 };

      const result = Transform.scalePoints(points, 0.5, 0.5, origin);

      expect(result[0].x).toBe(2);
      expect(result[0].y).toBe(3);
    });

    it("handles negative scale (mirror + scale)", () => {
      const points = [p("p1", 2, 3)];
      const origin = { x: 0, y: 0 };

      const result = Transform.scalePoints(points, -1, -1, origin);

      expect(result[0].x).toBe(-2);
      expect(result[0].y).toBe(-3);
    });
  });

  describe("reflectPoints", () => {
    it("reflects horizontally (flips Y across X axis)", () => {
      const points = [p("p1", 2, 3)];
      const origin = { x: 0, y: 0 };

      const result = Transform.reflectPoints(points, "horizontal", origin);

      expect(result[0].x).toBe(2);
      expect(result[0].y).toBe(-3);
    });

    it("reflects vertically (flips X across Y axis)", () => {
      const points = [p("p1", 2, 3)];
      const origin = { x: 0, y: 0 };

      const result = Transform.reflectPoints(points, "vertical", origin);

      expect(result[0].x).toBe(-2);
      expect(result[0].y).toBe(3);
    });

    it("reflects horizontally around custom origin", () => {
      const points = [p("p1", 2, 5)];
      const origin = { x: 0, y: 3 };

      const result = Transform.reflectPoints(points, "horizontal", origin);

      // y: 3 - (5-3) = 1
      expect(result[0].x).toBe(2);
      expect(result[0].y).toBe(1);
    });

    it("reflects vertically around custom origin", () => {
      const points = [p("p1", 5, 3)];
      const origin = { x: 3, y: 0 };

      const result = Transform.reflectPoints(points, "vertical", origin);

      // x: 3 - (5-3) = 1
      expect(result[0].x).toBe(1);
      expect(result[0].y).toBe(3);
    });

    it("reflects across 45° diagonal axis", () => {
      const points = [p("p1", 1, 0)];
      const origin = { x: 0, y: 0 };

      const result = Transform.reflectPoints(points, { angle: Math.PI / 4 }, origin);

      // Reflecting (1,0) across 45° line gives (0,1)
      expect(result[0].x).toBeCloseTo(0);
      expect(result[0].y).toBeCloseTo(1);
    });

    it("reflecting twice returns to original", () => {
      const points = [p("p1", 2, 3)];
      const origin = { x: 0, y: 0 };

      const once = Transform.reflectPoints(points, "horizontal", origin);
      const twice = Transform.reflectPoints(once, "horizontal", origin);

      expect(twice[0].x).toBeCloseTo(2);
      expect(twice[0].y).toBeCloseTo(3);
    });
  });

  describe("Bounds.fromPoints (replaces getSelectionBounds)", () => {
    it("returns null for empty array", () => {
      const result = Bounds.fromPoints([]);
      expect(result).toBeNull();
    });

    it("calculates bounds for single point", () => {
      const points = [p("p1", 5, 7)];

      const result = Bounds.fromPoints(points);

      expect(result).not.toBeNull();
      expect(Bounds.center(result!)).toEqual({ x: 5, y: 7 });
      expect(Bounds.width(result!)).toBe(0);
      expect(Bounds.height(result!)).toBe(0);
    });

    it("calculates bounds for multiple points", () => {
      const points = [p("p1", 0, 0), p("p2", 10, 0), p("p3", 10, 6), p("p4", 0, 6)];

      const result = Bounds.fromPoints(points);

      expect(result).not.toBeNull();
      expect(result!.min.x).toBe(0);
      expect(result!.min.y).toBe(0);
      expect(result!.max.x).toBe(10);
      expect(result!.max.y).toBe(6);
      expect(Bounds.width(result!)).toBe(10);
      expect(Bounds.height(result!)).toBe(6);
      expect(Bounds.center(result!)).toEqual({ x: 5, y: 3 });
    });
  });

  describe("Bounds.center (replaces getSelectionCenter)", () => {
    it("returns null for empty array", () => {
      const result = Bounds.fromPoints([]);
      expect(result).toBeNull();
    });

    it("returns center of bounding box", () => {
      const points = [p("p1", 0, 0), p("p2", 4, 6)];

      const result = Bounds.fromPoints(points);
      expect(result).not.toBeNull();
      expect(Bounds.center(result!)).toEqual({ x: 2, y: 3 });
    });
  });

  describe("convenience functions", () => {
    const points = [p("p1", 1, 0)];
    const origin = { x: 0, y: 0 };

    it("rotate90CCW rotates 90° counter-clockwise", () => {
      const result = Transform.rotate90CCW(points, origin);
      expect(result[0].x).toBeCloseTo(0);
      expect(result[0].y).toBeCloseTo(1);
    });

    it("rotate90CW rotates 90° clockwise", () => {
      const result = Transform.rotate90CW(points, origin);
      expect(result[0].x).toBeCloseTo(0);
      expect(result[0].y).toBeCloseTo(-1);
    });

    it("rotate180 rotates 180°", () => {
      const result = Transform.rotate180(points, origin);
      expect(result[0].x).toBeCloseTo(-1);
      expect(result[0].y).toBeCloseTo(0);
    });

    it("scaleUniform scales equally in both directions", () => {
      const pts = [p("p1", 2, 3)];
      const result = Transform.scaleUniform(pts, 2, origin);
      expect(result[0].x).toBe(4);
      expect(result[0].y).toBe(6);
    });

    it("flipHorizontal mirrors across X axis", () => {
      const pts = [p("p1", 2, 3)];
      const result = Transform.flipHorizontal(pts, origin);
      expect(result[0].x).toBe(2);
      expect(result[0].y).toBe(-3);
    });

    it("flipVertical mirrors across Y axis", () => {
      const pts = [p("p1", 2, 3)];
      const result = Transform.flipVertical(pts, origin);
      expect(result[0].x).toBe(-2);
      expect(result[0].y).toBe(3);
    });
  });

  describe("applyMatrix", () => {
    it("applies identity matrix (no change)", () => {
      const points = [p("p1", 5, 7)];
      const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

      const result = Transform.applyMatrix(points, identity);

      expect(result[0].x).toBeCloseTo(5);
      expect(result[0].y).toBeCloseTo(7);
    });

    it("applies scale matrix", () => {
      const points = [p("p1", 2, 3)];
      const scale2x = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };

      const result = Transform.applyMatrix(points, scale2x);

      expect(result[0].x).toBeCloseTo(4);
      expect(result[0].y).toBeCloseTo(6);
    });

    it("applies matrix around custom origin", () => {
      const points = [p("p1", 3, 4)];
      const scale2x = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
      const origin = { x: 1, y: 2 };

      const result = Transform.applyMatrix(points, scale2x, origin);

      // (3-1)*2 + 1 = 5, (4-2)*2 + 2 = 6
      expect(result[0].x).toBeCloseTo(5);
      expect(result[0].y).toBeCloseTo(6);
    });
  });

  describe("matrices", () => {
    it("rotate creates correct rotation matrix", () => {
      const mat = Transform.matrices.rotate(Math.PI / 2);
      // 90° rotation: cos=0, sin=1
      expect(mat.a).toBeCloseTo(0);
      expect(mat.b).toBeCloseTo(1);
      expect(mat.c).toBeCloseTo(-1);
      expect(mat.d).toBeCloseTo(0);
    });

    it("scale creates correct scale matrix", () => {
      const mat = Transform.matrices.scale(2, 3);
      expect(mat.a).toBe(2);
      expect(mat.d).toBe(3);
      expect(mat.b).toBe(0);
      expect(mat.c).toBe(0);
    });

    it("reflectHorizontal creates correct matrix", () => {
      const mat = Transform.matrices.reflectHorizontal();
      expect(mat.a).toBe(1);
      expect(mat.d).toBe(-1);
    });

    it("reflectVertical creates correct matrix", () => {
      const mat = Transform.matrices.reflectVertical();
      expect(mat.a).toBe(-1);
      expect(mat.d).toBe(1);
    });
  });
});
