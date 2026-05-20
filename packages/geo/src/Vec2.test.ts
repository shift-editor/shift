import { describe, it, expect } from "vitest";
import { Vec2 } from "./Vec2";

describe("Vec2", () => {
  describe("construction", () => {
    it("creates a vector with create()", () => {
      const v = Vec2.create(3, 4);
      expect(v).toEqual({ x: 3, y: 4 });
    });

    it("creates a zero vector", () => {
      expect(Vec2.zero()).toEqual({ x: 0, y: 0 });
    });

    it("creates unit vectors", () => {
      expect(Vec2.unitX()).toEqual({ x: 1, y: 0 });
      expect(Vec2.unitY()).toEqual({ x: 0, y: 1 });
    });

    it("creates vector from angle", () => {
      const v = Vec2.fromAngle(Math.PI / 2);
      expect(v.x).toBeCloseTo(0);
      expect(v.y).toBeCloseTo(1);
    });

    it("clones a vector", () => {
      const v = { x: 5, y: 7 };
      const cloned = Vec2.clone(v);
      expect(cloned).toEqual(v);
      expect(cloned).not.toBe(v);
    });
  });

  describe("basic operations", () => {
    it("adds two vectors", () => {
      expect(Vec2.add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
    });

    it("subtracts two vectors", () => {
      expect(Vec2.sub({ x: 5, y: 7 }, { x: 2, y: 3 })).toEqual({ x: 3, y: 4 });
    });

    it("scales a vector", () => {
      expect(Vec2.scale({ x: 2, y: 3 }, 3)).toEqual({ x: 6, y: 9 });
    });

    it("negates a vector", () => {
      expect(Vec2.negate({ x: 3, y: -4 })).toEqual({ x: -3, y: 4 });
    });

    it("multiplies component-wise", () => {
      expect(Vec2.mul({ x: 2, y: 3 }, { x: 4, y: 5 })).toEqual({ x: 8, y: 15 });
    });

    it("divides component-wise", () => {
      expect(Vec2.div({ x: 8, y: 15 }, { x: 4, y: 5 })).toEqual({ x: 2, y: 3 });
    });
  });

  describe("products", () => {
    it("computes dot product", () => {
      expect(Vec2.dot({ x: 1, y: 2 }, { x: 3, y: 4 })).toBe(11);
    });

    it("computes cross product", () => {
      expect(Vec2.cross({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(1);
      expect(Vec2.cross({ x: 0, y: 1 }, { x: 1, y: 0 })).toBe(-1);
    });
  });

  describe("length and distance", () => {
    it("computes length", () => {
      expect(Vec2.len({ x: 3, y: 4 })).toBe(5);
    });

    it("computes squared length", () => {
      expect(Vec2.lenSq({ x: 3, y: 4 })).toBe(25);
    });

    it("computes distance", () => {
      expect(Vec2.dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    });

    it("computes squared distance", () => {
      expect(Vec2.distSq({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25);
    });

    it("computes manhattan distance", () => {
      expect(Vec2.manhattanDist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7);
    });
  });

  describe("normalization", () => {
    it("normalizes a vector", () => {
      const v = Vec2.normalize({ x: 3, y: 4 });
      expect(v.x).toBeCloseTo(0.6);
      expect(v.y).toBeCloseTo(0.8);
    });

    it("handles zero vector normalization", () => {
      expect(Vec2.normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    });

    it("sets vector length", () => {
      const v = Vec2.setLen({ x: 3, y: 4 }, 10);
      expect(v.x).toBeCloseTo(6);
      expect(v.y).toBeCloseTo(8);
    });

    it("clamps vector length", () => {
      const v = Vec2.clampLen({ x: 3, y: 4 }, 2.5);
      expect(Vec2.len(v)).toBeCloseTo(2.5);
    });

    it("does not clamp if under max", () => {
      const v = Vec2.clampLen({ x: 1, y: 1 }, 10);
      expect(v).toEqual({ x: 1, y: 1 });
    });
  });

  describe("interpolation", () => {
    it("linearly interpolates", () => {
      const a = { x: 0, y: 0 };
      const b = { x: 10, y: 20 };
      expect(Vec2.lerp(a, b, 0)).toEqual(a);
      expect(Vec2.lerp(a, b, 1)).toEqual(b);
      expect(Vec2.lerp(a, b, 0.5)).toEqual({ x: 5, y: 10 });
    });

    it("linearly interpolates with rounding", () => {
      const a = { x: 0, y: 0 };
      const b = { x: 10, y: 10 };
      expect(Vec2.lerpInt(a, b, 0.33)).toEqual({ x: 3, y: 3 });
    });
  });

  describe("geometric operations", () => {
    it("mirrors a point across an anchor", () => {
      expect(Vec2.mirror({ x: 3, y: 5 }, { x: 0, y: 0 })).toEqual({
        x: -3,
        y: -5,
      });
      expect(Vec2.mirror({ x: 4, y: 6 }, { x: 2, y: 3 })).toEqual({
        x: 0,
        y: 0,
      });
    });

    it("projects a vector onto another", () => {
      const proj = Vec2.project({ x: 3, y: 4 }, { x: 1, y: 0 });
      expect(proj).toEqual({ x: 3, y: 0 });
    });

    it("computes rejection", () => {
      const rej = Vec2.reject({ x: 3, y: 4 }, { x: 1, y: 0 });
      expect(rej.x).toBeCloseTo(0);
      expect(rej.y).toBeCloseTo(4);
    });

    it("computes perpendicular (CCW)", () => {
      const perp = Vec2.perp({ x: 1, y: 0 });
      expect(perp.x).toBeCloseTo(0);
      expect(perp.y).toBe(1);
    });

    it("computes perpendicular (CW)", () => {
      expect(Vec2.perpCW({ x: 1, y: 0 })).toEqual({ x: 0, y: -1 });
    });

    it("reflects a vector", () => {
      const v = { x: 1, y: -1 };
      const normal = { x: 0, y: 1 };
      const reflected = Vec2.reflect(v, normal);
      expect(reflected.x).toBeCloseTo(1);
      expect(reflected.y).toBeCloseTo(1);
    });
  });

  describe("rotation and angles", () => {
    it("computes angle of vector", () => {
      expect(Vec2.angle({ x: 1, y: 0 })).toBeCloseTo(0);
      expect(Vec2.angle({ x: 0, y: 1 })).toBeCloseTo(Math.PI / 2);
      expect(Vec2.angle({ x: -1, y: 0 })).toBeCloseTo(Math.PI);
    });

    it("computes angle to another point", () => {
      const angle = Vec2.angleTo({ x: 0, y: 0 }, { x: 1, y: 1 });
      expect(angle).toBeCloseTo(Math.PI / 4);
    });

    it("computes angle between vectors", () => {
      const a = { x: 1, y: 0 };
      const b = { x: 0, y: 1 };
      expect(Vec2.angleBetween(a, b)).toBeCloseTo(Math.PI / 2);
    });

    it("rotates a vector", () => {
      const v = Vec2.rotate({ x: 1, y: 0 }, Math.PI / 2);
      expect(v.x).toBeCloseTo(0);
      expect(v.y).toBeCloseTo(1);
    });

    it("rotates around a point", () => {
      const v = Vec2.rotateAround({ x: 2, y: 0 }, { x: 1, y: 0 }, Math.PI);
      expect(v.x).toBeCloseTo(0);
      expect(v.y).toBeCloseTo(0);
    });
  });

  describe("predicates", () => {
    it("checks equality", () => {
      expect(Vec2.equals({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
      expect(Vec2.equals({ x: 1, y: 2 }, { x: 1.0001, y: 2 })).toBe(false);
      expect(Vec2.equals({ x: 1, y: 2 }, { x: 1.0001, y: 2 }, 0.001)).toBe(true);
    });

    it("checks if zero", () => {
      expect(Vec2.isZero({ x: 0, y: 0 })).toBe(true);
      expect(Vec2.isZero({ x: 0.0001, y: 0 })).toBe(false);
    });

    it("checks if parallel", () => {
      expect(Vec2.isParallel({ x: 1, y: 2 }, { x: 2, y: 4 })).toBe(true);
      expect(Vec2.isParallel({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(false);
    });

    it("checks if perpendicular", () => {
      expect(Vec2.isPerpendicular({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(true);
      expect(Vec2.isPerpendicular({ x: 1, y: 1 }, { x: 1, y: 0 })).toBe(false);
    });

    it("checks if point is within radius", () => {
      expect(Vec2.isWithin({ x: 0, y: 0 }, { x: 3, y: 4 }, 6)).toBe(true);
      expect(Vec2.isWithin({ x: 0, y: 0 }, { x: 3, y: 4 }, 5)).toBe(false);
      expect(Vec2.isWithin({ x: 0, y: 0 }, { x: 3, y: 4 }, 4)).toBe(false);
    });
  });

  describe("utility", () => {
    it("computes component-wise min", () => {
      expect(Vec2.min({ x: 1, y: 5 }, { x: 3, y: 2 })).toEqual({ x: 1, y: 2 });
    });

    it("computes component-wise max", () => {
      expect(Vec2.max({ x: 1, y: 5 }, { x: 3, y: 2 })).toEqual({ x: 3, y: 5 });
    });

    it("computes midpoint", () => {
      expect(Vec2.midpoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({
        x: 5,
        y: 10,
      });
    });

    it("converts to and from array", () => {
      const v = { x: 3, y: 4 };
      expect(Vec2.toArray(v)).toEqual([3, 4]);
      expect(Vec2.fromArray([3, 4])).toEqual(v);
    });

    it("rounds components", () => {
      expect(Vec2.floor({ x: 1.7, y: 2.3 })).toEqual({ x: 1, y: 2 });
      expect(Vec2.ceil({ x: 1.2, y: 2.8 })).toEqual({ x: 2, y: 3 });
      expect(Vec2.round({ x: 1.4, y: 2.6 })).toEqual({ x: 1, y: 3 });
    });
  });
});
