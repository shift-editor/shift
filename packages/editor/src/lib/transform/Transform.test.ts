import { describe, it, expect } from "vitest";
import { asPointId } from "@shift/types";
import { Transform } from "./Transform";

describe("Transform", () => {
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

      expect(result[0]!.id).toBe("p1");
      expect(result[0]!.x).toBeCloseTo(0);
      expect(result[0]!.y).toBeCloseTo(1);
    });

    it("rotates points 90° clockwise around origin", () => {
      const points = [p("p1", 0, 1)];
      const origin = { x: 0, y: 0 };

      const result = Transform.rotatePoints(points, -Math.PI / 2, origin);

      expect(result[0]!.x).toBeCloseTo(1);
      expect(result[0]!.y).toBeCloseTo(0);
    });

    it("rotates points 180° around origin", () => {
      const points = [p("p1", 1, 1)];
      const origin = { x: 0, y: 0 };

      const result = Transform.rotatePoints(points, Math.PI, origin);

      expect(result[0]!.x).toBeCloseTo(-1);
      expect(result[0]!.y).toBeCloseTo(-1);
    });

    it("rotates around a custom origin", () => {
      const points = [p("p1", 2, 0)];
      const origin = { x: 1, y: 0 };

      const result = Transform.rotatePoints(points, Math.PI / 2, origin);

      expect(result[0]!.x).toBeCloseTo(1);
      expect(result[0]!.y).toBeCloseTo(1);
    });

    it("handles multiple points", () => {
      const points = [p("p1", 1, 0), p("p2", 0, 1)];
      const origin = { x: 0, y: 0 };

      const result = Transform.rotatePoints(points, Math.PI / 2, origin);

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe("p1");
      expect(result[1]!.id).toBe("p2");
    });

    it("preserves original array (immutable)", () => {
      const points = [p("p1", 1, 0)];
      const origin = { x: 0, y: 0 };

      Transform.rotatePoints(points, Math.PI / 2, origin);

      expect(points[0]!.x).toBe(1);
      expect(points[0]!.y).toBe(0);
    });
  });

  describe("scalePoints", () => {
    it("scales points uniformly from origin", () => {
      const points = [p("p1", 2, 3)];
      const origin = { x: 0, y: 0 };

      const result = Transform.scalePoints(points, 2, 2, origin);

      expect(result[0]!.x).toBe(4);
      expect(result[0]!.y).toBe(6);
    });

    it("scales points non-uniformly", () => {
      const points = [p("p1", 2, 3)];
      const origin = { x: 0, y: 0 };

      const result = Transform.scalePoints(points, 2, 3, origin);

      expect(result[0]!.x).toBe(4);
      expect(result[0]!.y).toBe(9);
    });

    it("scales from a custom origin", () => {
      const points = [p("p1", 3, 4)];
      const origin = { x: 1, y: 2 };

      const result = Transform.scalePoints(points, 2, 2, origin);

      // (3-1)*2 + 1 = 5, (4-2)*2 + 2 = 6
      expect(result[0]!.x).toBe(5);
      expect(result[0]!.y).toBe(6);
    });

    it("handles scale factor of 0.5 (shrink)", () => {
      const points = [p("p1", 4, 6)];
      const origin = { x: 0, y: 0 };

      const result = Transform.scalePoints(points, 0.5, 0.5, origin);

      expect(result[0]!.x).toBe(2);
      expect(result[0]!.y).toBe(3);
    });

    it("handles negative scale (mirror + scale)", () => {
      const points = [p("p1", 2, 3)];
      const origin = { x: 0, y: 0 };

      const result = Transform.scalePoints(points, -1, -1, origin);

      expect(result[0]!.x).toBe(-2);
      expect(result[0]!.y).toBe(-3);
    });
  });

  describe("applyMatrix", () => {
    it("applies identity matrix (no change)", () => {
      const points = [p("p1", 5, 7)];
      const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

      const result = Transform.applyMatrix(points, identity);

      expect(result[0]!.x).toBeCloseTo(5);
      expect(result[0]!.y).toBeCloseTo(7);
    });

    it("applies scale matrix", () => {
      const points = [p("p1", 2, 3)];
      const scale2x = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };

      const result = Transform.applyMatrix(points, scale2x);

      expect(result[0]!.x).toBeCloseTo(4);
      expect(result[0]!.y).toBeCloseTo(6);
    });

    it("applies matrix around custom origin", () => {
      const points = [p("p1", 3, 4)];
      const scale2x = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
      const origin = { x: 1, y: 2 };

      const result = Transform.applyMatrix(points, scale2x, origin);

      // (3-1)*2 + 1 = 5, (4-2)*2 + 2 = 6
      expect(result[0]!.x).toBeCloseTo(5);
      expect(result[0]!.y).toBeCloseTo(6);
    });
  });
});
