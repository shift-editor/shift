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

  describe("snapping utilities", () => {
    describe("constrainToAxis", () => {
      it("constrains to horizontal when x is dominant", () => {
        expect(Vec2.constrainToAxis({ x: 10, y: 3 })).toEqual({ x: 10, y: 0 });
      });

      it("constrains to vertical when y is dominant", () => {
        expect(Vec2.constrainToAxis({ x: 3, y: 10 })).toEqual({ x: 0, y: 10 });
      });

      it("constrains to horizontal when equal", () => {
        expect(Vec2.constrainToAxis({ x: 5, y: 5 })).toEqual({ x: 5, y: 0 });
      });

      it("handles negative values", () => {
        expect(Vec2.constrainToAxis({ x: -10, y: 3 })).toEqual({ x: -10, y: 0 });
        expect(Vec2.constrainToAxis({ x: 3, y: -10 })).toEqual({ x: 0, y: -10 });
      });
    });

    describe("snapAngle", () => {
      it("snaps to nearest 45 degrees by default", () => {
        expect(Vec2.snapAngle(Math.PI / 16)).toBeCloseTo(0);
        expect(Vec2.snapAngle(Math.PI / 3)).toBeCloseTo(Math.PI / 4);
        expect(Vec2.snapAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2);
      });

      it("snaps to 15 degrees when specified", () => {
        const inc = Math.PI / 12;
        expect(Vec2.snapAngle(Math.PI / 10, inc)).toBeCloseTo(inc);
        expect(Vec2.snapAngle(Math.PI / 48, inc)).toBeCloseTo(0);
      });

      it("handles negative angles", () => {
        expect(Vec2.snapAngle(-Math.PI / 16)).toBeCloseTo(0);
        expect(Vec2.snapAngle(-Math.PI / 3)).toBeCloseTo(-Math.PI / 4);
      });
    });

    describe("snapToAngle", () => {
      it("snaps vector to 45-degree increments preserving length", () => {
        const v = { x: 10, y: 3 };
        const snapped = Vec2.snapToAngle(v);
        expect(Vec2.angle(snapped)).toBeCloseTo(0);
        expect(Vec2.len(snapped)).toBeCloseTo(Vec2.len(v));
      });

      it("handles zero vector", () => {
        expect(Vec2.snapToAngle({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
      });

      it("snaps to custom angle increments", () => {
        const v = { x: 10, y: 2 };
        const snapped = Vec2.snapToAngle(v, Math.PI / 12);
        const snappedAngle = Vec2.angle(snapped);
        expect(snappedAngle).toBeCloseTo(Math.PI / 12);
        expect(Vec2.len(snapped)).toBeCloseTo(Vec2.len(v));
      });

      it("snaps vector pointing in negative direction", () => {
        const v = { x: -10, y: 3 };
        const snapped = Vec2.snapToAngle(v);
        expect(Vec2.angle(snapped)).toBeCloseTo(Math.PI);
        expect(Vec2.len(snapped)).toBeCloseTo(Vec2.len(v));
      });
    });

    describe("snapAngleWithHysteresis", () => {
      it("snaps to nearest increment when no previous snap", () => {
        expect(Vec2.snapAngleWithHysteresis(Math.PI / 16, null)).toBeCloseTo(0);
        expect(Vec2.snapAngleWithHysteresis(Math.PI / 3, null)).toBeCloseTo(Math.PI / 4);
      });

      it("sticks to previous snap within threshold", () => {
        const previousSnapped = 0;
        const smallOffset = (Math.PI / 4) * 0.3;
        expect(Vec2.snapAngleWithHysteresis(smallOffset, previousSnapped)).toBeCloseTo(0);
      });

      it("breaks free when exceeding threshold", () => {
        const previousSnapped = 0;
        const largeOffset = (Math.PI / 4) * 0.5;
        expect(Vec2.snapAngleWithHysteresis(largeOffset, previousSnapped)).toBeCloseTo(Math.PI / 4);
      });

      it("respects custom hysteresis factor", () => {
        const previousSnapped = 0;
        const offset = (Math.PI / 4) * 0.3;
        expect(Vec2.snapAngleWithHysteresis(offset, previousSnapped, Math.PI / 4, 0.5)).toBeCloseTo(
          0,
        );
        expect(Vec2.snapAngleWithHysteresis(offset, previousSnapped, Math.PI / 4, 0.2)).toBeCloseTo(
          0,
        );
        const largerOffset = (Math.PI / 4) * 0.6;
        expect(
          Vec2.snapAngleWithHysteresis(largerOffset, previousSnapped, Math.PI / 4, 0.5),
        ).toBeCloseTo(Math.PI / 4);
      });
    });

    describe("snapToAngleWithHysteresis", () => {
      it("returns snapped position and angle", () => {
        const v = { x: 10, y: 3 };
        const result = Vec2.snapToAngleWithHysteresis(v, null);
        expect(result.snappedAngle).toBeCloseTo(0);
        expect(Vec2.len(result.position)).toBeCloseTo(Vec2.len(v));
      });

      it("handles zero vector", () => {
        const result = Vec2.snapToAngleWithHysteresis({ x: 0, y: 0 }, null);
        expect(result.position).toEqual({ x: 0, y: 0 });
        expect(result.snappedAngle).toBe(0);
      });

      it("sticks to previous angle within threshold", () => {
        const previousAngle = 0;
        const v = Vec2.fromAngle((Math.PI / 4) * 0.3);
        const scaled = Vec2.scale(v, 10);
        const result = Vec2.snapToAngleWithHysteresis(scaled, previousAngle);
        expect(result.snappedAngle).toBeCloseTo(0);
      });

      it("breaks free from previous angle when exceeding threshold", () => {
        const previousAngle = 0;
        const v = Vec2.fromAngle((Math.PI / 4) * 0.5);
        const scaled = Vec2.scale(v, 10);
        const result = Vec2.snapToAngleWithHysteresis(scaled, previousAngle);
        expect(result.snappedAngle).toBeCloseTo(Math.PI / 4);
      });
    });

    describe("constrainToAxisWithHysteresis", () => {
      it("picks dominant axis when no previous axis", () => {
        const result1 = Vec2.constrainToAxisWithHysteresis({ x: 10, y: 3 }, null);
        expect(result1.axis).toBe("x");
        expect(result1.delta).toEqual({ x: 10, y: 0 });

        const result2 = Vec2.constrainToAxisWithHysteresis({ x: 3, y: 10 }, null);
        expect(result2.axis).toBe("y");
        expect(result2.delta).toEqual({ x: 0, y: 10 });
      });

      it("sticks to previous axis within threshold", () => {
        const result = Vec2.constrainToAxisWithHysteresis({ x: 5, y: 6 }, "x");
        expect(result.axis).toBe("x");
        expect(result.delta).toEqual({ x: 5, y: 0 });
      });

      it("switches axis when strongly dominant in other direction", () => {
        const result = Vec2.constrainToAxisWithHysteresis({ x: 2, y: 10 }, "x");
        expect(result.axis).toBe("y");
        expect(result.delta).toEqual({ x: 0, y: 10 });
      });

      it("respects custom threshold", () => {
        const result1 = Vec2.constrainToAxisWithHysteresis({ x: 3, y: 7 }, "x", 0.5);
        expect(result1.axis).toBe("y");

        const result2 = Vec2.constrainToAxisWithHysteresis({ x: 3, y: 7 }, "x", 0.8);
        expect(result2.axis).toBe("x");
      });

      it("handles negative values", () => {
        const result = Vec2.constrainToAxisWithHysteresis({ x: -10, y: 3 }, null);
        expect(result.axis).toBe("x");
        expect(result.delta).toEqual({ x: -10, y: 0 });
      });
    });
  });
});
