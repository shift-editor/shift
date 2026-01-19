import { describe, it, expect } from "vitest";
import { Curve } from "./Curve";
import { Vec2 } from "./Vec2";

describe("Curve", () => {
  describe("LineCurve", () => {
    const line = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });

    it("creates a line segment", () => {
      expect(line.type).toBe("line");
      expect(line.p0).toEqual({ x: 0, y: 0 });
      expect(line.p1).toEqual({ x: 10, y: 0 });
    });

    it("evaluates point at t", () => {
      expect(Curve.pointAt(line, 0)).toEqual({ x: 0, y: 0 });
      expect(Curve.pointAt(line, 1)).toEqual({ x: 10, y: 0 });
      expect(Curve.pointAt(line, 0.5)).toEqual({ x: 5, y: 0 });
    });

    it("computes tangent", () => {
      const tangent = Curve.tangentAt(line, 0.5);
      expect(tangent).toEqual({ x: 10, y: 0 });
    });

    it("computes unit tangent", () => {
      const tangent = Curve.unitTangentAt(line, 0.5);
      expect(tangent).toEqual({ x: 1, y: 0 });
    });

    it("computes normal", () => {
      const normal = Curve.normalAt(line, 0.5);
      expect(normal.x).toBeCloseTo(0);
      expect(normal.y).toBeCloseTo(1);
    });

    it("finds closest point on segment", () => {
      // Point above the line
      const result1 = Curve.closestPoint(line, { x: 5, y: 5 });
      expect(result1.t).toBeCloseTo(0.5);
      expect(result1.point).toEqual({ x: 5, y: 0 });
      expect(result1.distance).toBeCloseTo(5);

      // Point before start
      const result2 = Curve.closestPoint(line, { x: -5, y: 0 });
      expect(result2.t).toBe(0);
      expect(result2.point).toEqual({ x: 0, y: 0 });

      // Point after end
      const result3 = Curve.closestPoint(line, { x: 15, y: 0 });
      expect(result3.t).toBe(1);
      expect(result3.point).toEqual({ x: 10, y: 0 });
    });

    it("computes distance to point", () => {
      expect(Curve.distanceTo(line, { x: 5, y: 3 })).toBeCloseTo(3);
    });

    it("computes length", () => {
      expect(Curve.length(line)).toBe(10);
    });

    it("computes bounds", () => {
      const diagonalLine = Curve.line({ x: 0, y: 0 }, { x: 10, y: 20 });
      const bounds = Curve.bounds(diagonalLine);
      expect(bounds.min).toEqual({ x: 0, y: 0 });
      expect(bounds.max).toEqual({ x: 10, y: 20 });
    });

    it("splits at parameter t", () => {
      const [left, right] = Curve.splitAt(line, 0.3);
      expect(left.type).toBe("line");
      expect(right.type).toBe("line");
      expect(left.p0).toEqual({ x: 0, y: 0 });
      expect(left.p1).toEqual({ x: 3, y: 0 });
      expect(right.p0).toEqual({ x: 3, y: 0 });
      expect(right.p1).toEqual({ x: 10, y: 0 });
    });

    it("samples points along segment", () => {
      const points = Curve.sample(line, 2);
      expect(points).toHaveLength(3);
      expect(points[0]).toEqual({ x: 0, y: 0 });
      expect(points[1]).toEqual({ x: 5, y: 0 });
      expect(points[2]).toEqual({ x: 10, y: 0 });
    });
  });

  describe("QuadraticCurve", () => {
    // Quadratic with control point above the line
    const quad = Curve.quadratic(
      { x: 0, y: 0 },
      { x: 5, y: 10 },
      { x: 10, y: 0 },
    );

    it("creates a quadratic segment", () => {
      expect(quad.type).toBe("quadratic");
      expect(quad.p0).toEqual({ x: 0, y: 0 });
      expect(quad.c).toEqual({ x: 5, y: 10 });
      expect(quad.p1).toEqual({ x: 10, y: 0 });
    });

    it("evaluates point at t", () => {
      expect(Curve.pointAt(quad, 0)).toEqual({ x: 0, y: 0 });
      expect(Curve.pointAt(quad, 1)).toEqual({ x: 10, y: 0 });

      // At t=0.5, the curve should be at its peak
      const mid = Curve.pointAt(quad, 0.5);
      expect(mid.x).toBeCloseTo(5);
      expect(mid.y).toBeCloseTo(5); // 0.25*0 + 0.5*10 + 0.25*0 = 5
    });

    it("computes tangent at t", () => {
      // At t=0, tangent points toward control point
      const t0 = Curve.tangentAt(quad, 0);
      expect(t0.x).toBeCloseTo(10);
      expect(t0.y).toBeCloseTo(20);

      // At t=1, tangent points from control point to end
      const t1 = Curve.tangentAt(quad, 1);
      expect(t1.x).toBeCloseTo(10);
      expect(t1.y).toBeCloseTo(-20);
    });

    it("finds closest point", () => {
      const result = Curve.closestPoint(quad, { x: 5, y: 10 });
      // The closest point should be near the peak
      expect(result.t).toBeCloseTo(0.5, 1);
      expect(result.point.x).toBeCloseTo(5, 1);
    });

    it("computes bounds", () => {
      const bounds = Curve.bounds(quad);
      expect(bounds.min.x).toBeCloseTo(0);
      expect(bounds.min.y).toBeCloseTo(0);
      expect(bounds.max.x).toBeCloseTo(10);
      expect(bounds.max.y).toBeCloseTo(5); // Peak of quadratic
    });

    it("splits at parameter t", () => {
      const [left, right] = Curve.splitAt(quad, 0.5);
      expect(left.type).toBe("quadratic");
      expect(right.type).toBe("quadratic");

      // Left segment should end at midpoint
      const leftEnd = Curve.pointAt(left, 1);
      const rightStart = Curve.pointAt(right, 0);
      expect(Vec2.equals(leftEnd, rightStart, 0.001)).toBe(true);
    });

    it("converts to cubic", () => {
      const cubic = Curve.quadraticToCubic(quad);
      expect(cubic.type).toBe("cubic");

      // The converted cubic should pass through the same points
      for (let t = 0; t <= 1; t += 0.1) {
        const quadPoint = Curve.pointAt(quad, t);
        const cubicPoint = Curve.pointAt(cubic, t);
        expect(Vec2.dist(quadPoint, cubicPoint)).toBeLessThan(0.01);
      }
    });
  });

  describe("CubicCurve", () => {
    // S-curve
    const cubic = Curve.cubic(
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: -10 },
      { x: 10, y: 0 },
    );

    it("creates a cubic segment", () => {
      expect(cubic.type).toBe("cubic");
      expect(cubic.p0).toEqual({ x: 0, y: 0 });
      expect(cubic.c0).toEqual({ x: 0, y: 10 });
      expect(cubic.c1).toEqual({ x: 10, y: -10 });
      expect(cubic.p1).toEqual({ x: 10, y: 0 });
    });

    it("evaluates point at t", () => {
      expect(Curve.pointAt(cubic, 0)).toEqual({ x: 0, y: 0 });
      expect(Curve.pointAt(cubic, 1)).toEqual({ x: 10, y: 0 });

      const mid = Curve.pointAt(cubic, 0.5);
      expect(mid.x).toBeCloseTo(5);
      expect(mid.y).toBeCloseTo(0); // Symmetric S-curve returns to y=0 at midpoint
    });

    it("computes tangent at t", () => {
      // At t=0, tangent is from p0 to c0
      const t0 = Curve.tangentAt(cubic, 0);
      expect(t0.x).toBeCloseTo(0);
      expect(t0.y).toBeCloseTo(30); // 3 * (c0 - p0)

      // At t=1, tangent is from c1 to p1
      const t1 = Curve.tangentAt(cubic, 1);
      expect(t1.x).toBeCloseTo(0);
      expect(t1.y).toBeCloseTo(30); // 3 * (p1 - c1)
    });

    it("finds closest point", () => {
      // Test with a point near the start
      const result = Curve.closestPoint(cubic, { x: 0, y: 5 });
      expect(result.t).toBeLessThan(0.5);
      expect(result.distance).toBeLessThan(5);
    });

    it("computes bounds", () => {
      const bounds = Curve.bounds(cubic);
      expect(bounds.min.x).toBeCloseTo(0);
      expect(bounds.max.x).toBeCloseTo(10);
      // Y bounds depend on extrema
      expect(bounds.min.y).toBeLessThan(0);
      expect(bounds.max.y).toBeGreaterThan(0);
    });

    it("splits at parameter t", () => {
      const [left, right] = Curve.splitAt(cubic, 0.5);
      expect(left.type).toBe("cubic");
      expect(right.type).toBe("cubic");

      // Verify continuity at split point
      const leftEnd = Curve.pointAt(left, 1);
      const rightStart = Curve.pointAt(right, 0);
      expect(Vec2.dist(leftEnd, rightStart)).toBeLessThan(0.001);

      // Verify the split preserves the curve shape
      const originalMid = Curve.pointAt(cubic, 0.25);
      const leftMid = Curve.pointAt(left, 0.5);
      expect(Vec2.dist(originalMid, leftMid)).toBeLessThan(0.001);
    });

    it("approximates length", () => {
      const len = Curve.length(cubic);
      // For this S-curve, length should be roughly between 10 and 20
      expect(len).toBeGreaterThan(10);
      expect(len).toBeLessThan(30);
    });
  });

  describe("type guards", () => {
    it("identifies line segments", () => {
      const line = Curve.line({ x: 0, y: 0 }, { x: 1, y: 1 });
      expect(Curve.isLine(line)).toBe(true);
      expect(Curve.isCubic(line)).toBe(false);
      expect(Curve.isQuadratic(line)).toBe(false);
    });

    it("identifies quadratic segments", () => {
      const quad = Curve.quadratic(
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 0 },
      );
      expect(Curve.isLine(quad)).toBe(false);
      expect(Curve.isCubic(quad)).toBe(false);
      expect(Curve.isQuadratic(quad)).toBe(true);
    });

    it("identifies cubic segments", () => {
      const cubic = Curve.cubic(
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 3, y: 0 },
      );
      expect(Curve.isLine(cubic)).toBe(false);
      expect(Curve.isCubic(cubic)).toBe(true);
      expect(Curve.isQuadratic(cubic)).toBe(false);
    });
  });

  describe("startPoint and endPoint", () => {
    it("returns endpoints for all segment types", () => {
      const line = Curve.line({ x: 0, y: 0 }, { x: 10, y: 10 });
      const quad = Curve.quadratic(
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 0 },
      );
      const cubic = Curve.cubic(
        { x: 0, y: 0 },
        { x: 3, y: 3 },
        { x: 7, y: 3 },
        { x: 10, y: 0 },
      );

      expect(Curve.startPoint(line)).toEqual({ x: 0, y: 0 });
      expect(Curve.endPoint(line)).toEqual({ x: 10, y: 10 });

      expect(Curve.startPoint(quad)).toEqual({ x: 0, y: 0 });
      expect(Curve.endPoint(quad)).toEqual({ x: 10, y: 0 });

      expect(Curve.startPoint(cubic)).toEqual({ x: 0, y: 0 });
      expect(Curve.endPoint(cubic)).toEqual({ x: 10, y: 0 });
    });
  });
});
