import { describe, it, expect } from "vitest";
import { Mat } from "./Mat";

describe("Mat - 2D Affine Transform Matrix", () => {
  describe("constructor", () => {
    it("should create a matrix with specified components", () => {
      const m = new Mat(2, 3, 4, 5, 6, 7);
      expect(m.a).toBe(2);
      expect(m.b).toBe(3);
      expect(m.c).toBe(4);
      expect(m.d).toBe(5);
      expect(m.e).toBe(6);
      expect(m.f).toBe(7);
    });
  });

  describe("Identity", () => {
    it("should create identity matrix", () => {
      const m = Mat.Identity();
      expect(m.a).toBe(1);
      expect(m.b).toBe(0);
      expect(m.c).toBe(0);
      expect(m.d).toBe(1);
      expect(m.e).toBe(0);
      expect(m.f).toBe(0);
    });

    it("should leave point unchanged when applied", () => {
      const m = Mat.Identity();
      const p = Mat.applyToPoint(m, { x: 10, y: 20 });
      expect(p.x).toBe(10);
      expect(p.y).toBe(20);
    });
  });

  describe("translate", () => {
    it("should translate by x and y", () => {
      const m = Mat.Identity().translate(5, 10);
      expect(m.e).toBe(5);
      expect(m.f).toBe(10);
    });

    it("should affect point transformation", () => {
      const m = Mat.Identity().translate(5, 10);
      const p = Mat.applyToPoint(m, { x: 1, y: 2 });
      expect(p.x).toBe(6);
      expect(p.y).toBe(12);
    });

    it("should be chainable", () => {
      const m = Mat.Identity().translate(5, 10).translate(3, 4);
      expect(m.e).toBe(8);
      expect(m.f).toBe(14);
    });
  });

  describe("scale", () => {
    it("should scale x and y independently", () => {
      const m = Mat.Identity().scale(2, 3);
      expect(m.a).toBe(2);
      expect(m.d).toBe(3);
    });

    it("should affect point transformation", () => {
      const m = Mat.Identity().scale(2, 3);
      const p = Mat.applyToPoint(m, { x: 4, y: 5 });
      expect(p.x).toBe(8);
      expect(p.y).toBe(15);
    });

    it("should support negative scale (flip)", () => {
      const m = Mat.Identity().scale(-1, 1);
      const p = Mat.applyToPoint(m, { x: 5, y: 10 });
      expect(p.x).toBe(-5);
      expect(p.y).toBe(10);
    });
  });

  describe("rotate", () => {
    it("should rotate by angle in radians", () => {
      const m = Mat.Identity().rotate(Math.PI / 2);
      const p = Mat.applyToPoint(m, { x: 1, y: 0 });
      expect(p.x).toBeCloseTo(0);
      expect(p.y).toBeCloseTo(1);
    });

    it("should rotate 90 degrees correctly", () => {
      const m = Mat.Identity().rotate(Math.PI / 2);
      expect(m.a).toBeCloseTo(0);
      expect(m.b).toBeCloseTo(1);
      expect(m.c).toBeCloseTo(-1);
      expect(m.d).toBeCloseTo(0);
    });

    it("should rotate 180 degrees correctly", () => {
      const m = Mat.Identity().rotate(Math.PI);
      const p = Mat.applyToPoint(m, { x: 5, y: 10 });
      expect(p.x).toBeCloseTo(-5);
      expect(p.y).toBeCloseTo(-10);
    });
  });

  describe("multiply", () => {
    it("should compose two transforms", () => {
      const m1 = Mat.Identity().translate(5, 10);
      const m2 = Mat.Identity().scale(2, 3);
      m1.multiply(m2);

      const p = Mat.applyToPoint(m1, { x: 1, y: 1 });
      expect(p.x).toBeCloseTo(7); // (1 * 2) + 5
      expect(p.y).toBeCloseTo(13); // (1 * 3) + 10
    });

    it("should be chainable", () => {
      const m = Mat.Identity()
        .translate(5, 10)
        .multiply(Mat.Scale(2, 2))
        .multiply(Mat.Translate(1, 1));

      expect(m).toBeDefined();
    });

    it("should handle order of operations correctly", () => {
      const m2 = new Mat(2, 0, 0, 1, 0, 0); // scale (2, 1)
      const result = new Mat(1, 0, 0, 1, 5, 0).multiply(m2); // translate (5, 0) then scale

      const p = Mat.applyToPoint(result, { x: 1, y: 1 });
      expect(p.x).toBeCloseTo(7); // 1*2 + 5
      expect(p.y).toBeCloseTo(1);
    });
  });

  describe("Compose static", () => {
    it("should compose two matrices", () => {
      const m1 = Mat.Translate(5, 10);
      const m2 = Mat.Scale(2, 2);
      const result = Mat.Compose(m1, m2);

      const p = Mat.applyToPoint(result, { x: 1, y: 1 });
      expect(p.x).toBeCloseTo(7); // (1 * 2) + 5
      expect(p.y).toBeCloseTo(12); // (1 * 2) + 10
    });
  });

  describe("invert", () => {
    it("should invert an identity matrix", () => {
      const m = Mat.Identity().invert();
      expect(m.a).toBeCloseTo(1);
      expect(m.b).toBeCloseTo(0);
      expect(m.c).toBeCloseTo(0);
      expect(m.d).toBeCloseTo(1);
      expect(m.e).toBeCloseTo(0);
      expect(m.f).toBeCloseTo(0);
    });

    it("should invert translation", () => {
      const m = Mat.Translate(5, 10).invert();
      expect(m.e).toBe(-5);
      expect(m.f).toBe(-10);
    });

    it("should invert scale", () => {
      const m = Mat.Scale(2, 4).invert();
      expect(m.a).toBeCloseTo(0.5);
      expect(m.d).toBeCloseTo(0.25);
    });

    it("should round-trip with composition", () => {
      const m = Mat.Translate(5, 10).scale(2, 3);
      const inv = Mat.Inverse(m);
      const identity = Mat.Compose(m, inv);

      expect(identity.a).toBeCloseTo(1);
      expect(identity.b).toBeCloseTo(0);
      expect(identity.c).toBeCloseTo(0);
      expect(identity.d).toBeCloseTo(1);
      expect(identity.e).toBeCloseTo(0, 5);
      expect(identity.f).toBeCloseTo(0, 5);
    });

    it("should throw on singular matrix", () => {
      const m = new Mat(0, 0, 0, 0, 0, 0);
      expect(() => m.invert()).toThrow();
    });

    it("should invert rotation matrix", () => {
      const m = Mat.Rotate(Math.PI / 4);
      const inv = Mat.Inverse(m);

      // Rotation inverse is just negative rotation
      const m2 = Mat.Rotate(-Math.PI / 4);
      expect(inv.a).toBeCloseTo(m2.a);
      expect(inv.b).toBeCloseTo(m2.b);
      expect(inv.c).toBeCloseTo(m2.c);
      expect(inv.d).toBeCloseTo(m2.d);
    });

    it("should be chainable", () => {
      const m = Mat.Identity().translate(5, 10).invert();
      expect(m.e).toBe(-5);
      expect(m.f).toBe(-10);
    });
  });

  describe("Inverse static", () => {
    it("should create inverse without mutating original", () => {
      const m = Mat.Translate(5, 10);
      const inv = Mat.Inverse(m);

      expect(m.e).toBe(5); // Original unchanged
      expect(inv.e).toBe(-5);
    });
  });

  describe("applyToPoint", () => {
    it("should transform a point correctly", () => {
      const m = Mat.Translate(10, 20);
      const p = Mat.applyToPoint(m, { x: 5, y: 5 });
      expect(p.x).toBe(15);
      expect(p.y).toBe(25);
    });

    it("should handle scale transformation", () => {
      const m = Mat.Scale(2, 3);
      const p = Mat.applyToPoint(m, { x: 4, y: 5 });
      expect(p.x).toBe(8);
      expect(p.y).toBe(15);
    });

    it("should handle combined transformation", () => {
      const m = Mat.Identity().translate(5, 10).scale(2, 2);
      const p = Mat.applyToPoint(m, { x: 1, y: 1 });
      expect(p.x).toBeCloseTo(7);
      expect(p.y).toBeCloseTo(12);
    });
  });

  describe("toCanvasTransform", () => {
    it("should return array in correct order", () => {
      const m = new Mat(1, 2, 3, 4, 5, 6);
      const [a, b, c, d, e, f] = m.toCanvasTransform();
      expect(a).toBe(1);
      expect(b).toBe(2);
      expect(c).toBe(3);
      expect(d).toBe(4);
      expect(e).toBe(5);
      expect(f).toBe(6);
    });
  });

  describe("clone", () => {
    it("should create independent copy", () => {
      const m1 = new Mat(1, 2, 3, 4, 5, 6);
      const m2 = m1.clone();

      m2.a = 10;
      expect(m1.a).toBe(1);
      expect(m2.a).toBe(10);
    });

    it("should have same values as original", () => {
      const m1 = Mat.Identity().translate(5, 10).scale(2, 3);
      const m2 = m1.clone();

      expect(m2.a).toBe(m1.a);
      expect(m2.b).toBe(m1.b);
      expect(m2.c).toBe(m1.c);
      expect(m2.d).toBe(m1.d);
      expect(m2.e).toBe(m1.e);
      expect(m2.f).toBe(m1.f);
    });
  });

  describe("complex transforms", () => {
    it("should handle scale + translate correctly", () => {
      const m = Mat.Identity().scale(2, 2).translate(5, 10);
      const p = Mat.applyToPoint(m, { x: 1, y: 1 });
      expect(p.x).toBeCloseTo(7);
      expect(p.y).toBeCloseTo(12);
    });

    it("should handle translate + scale correctly", () => {
      const m = Mat.Identity().translate(5, 10).scale(2, 2);
      const p = Mat.applyToPoint(m, { x: 1, y: 1 });
      expect(p.x).toBeCloseTo(7);
      expect(p.y).toBeCloseTo(12);
    });

    it("should handle rotate + translate", () => {
      const m = Mat.Identity()
        .rotate(Math.PI / 2)
        .translate(1, 0);
      const p = Mat.applyToPoint(m, { x: 1, y: 0 });
      expect(p.x).toBeCloseTo(1);
      expect(p.y).toBeCloseTo(1);
    });
  });

  describe("determinant and singular matrix", () => {
    it("should detect non-invertible matrices", () => {
      const m = new Mat(1, 0, 1, 0, 0, 0); // Singular: det = 0
      expect(() => Mat.Inverse(m)).toThrow();
    });

    it("should work with non-singular matrices", () => {
      const m = new Mat(2, 1, 3, 2, 4, 5); // Non-singular
      const inv = Mat.Inverse(m);
      expect(inv).toBeDefined();
    });
  });

  describe("round-trip transforms", () => {
    it("should preserve point after scale and inverse scale", () => {
      const m = Mat.Scale(2, 3);
      const inv = Mat.Inverse(m);
      const result = Mat.Compose(m, inv);

      const p = { x: 10, y: 20 };
      const transformed = Mat.applyToPoint(result, p);

      expect(transformed.x).toBeCloseTo(p.x);
      expect(transformed.y).toBeCloseTo(p.y);
    });

    it("should preserve point after complex transform and inverse", () => {
      const m = Mat.Identity()
        .translate(5, 10)
        .scale(2, 3)
        .rotate(Math.PI / 6);

      const inv = Mat.Inverse(m);
      const result = Mat.Compose(m, inv);

      const p = { x: 100, y: 200 };
      const transformed = Mat.applyToPoint(result, p);

      expect(transformed.x).toBeCloseTo(p.x, 5);
      expect(transformed.y).toBeCloseTo(p.y, 5);
    });
  });

  describe("fromDecomposed", () => {
    it("should create identity matrix from default decomposed", () => {
      const d = {
        translateX: 0,
        translateY: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        skewX: 0,
        skewY: 0,
        tCenterX: 0,
        tCenterY: 0,
      };
      const m = Mat.fromDecomposed(d);
      expect(m.a).toBeCloseTo(1);
      expect(m.b).toBeCloseTo(0);
      expect(m.c).toBeCloseTo(0);
      expect(m.d).toBeCloseTo(1);
      expect(m.e).toBeCloseTo(0);
      expect(m.f).toBeCloseTo(0);
    });

    it("should create translation matrix", () => {
      const d = {
        translateX: 100,
        translateY: 50,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        skewX: 0,
        skewY: 0,
        tCenterX: 0,
        tCenterY: 0,
      };
      const m = Mat.fromDecomposed(d);
      const p = Mat.applyToPoint(m, { x: 10, y: 20 });
      expect(p.x).toBeCloseTo(110);
      expect(p.y).toBeCloseTo(70);
    });

    it("should create scale matrix", () => {
      const d = {
        translateX: 0,
        translateY: 0,
        rotation: 0,
        scaleX: 2,
        scaleY: 3,
        skewX: 0,
        skewY: 0,
        tCenterX: 0,
        tCenterY: 0,
      };
      const m = Mat.fromDecomposed(d);
      const p = Mat.applyToPoint(m, { x: 10, y: 20 });
      expect(p.x).toBeCloseTo(20);
      expect(p.y).toBeCloseTo(60);
    });

    it("should create rotation matrix", () => {
      const d = {
        translateX: 0,
        translateY: 0,
        rotation: 90,
        scaleX: 1,
        scaleY: 1,
        skewX: 0,
        skewY: 0,
        tCenterX: 0,
        tCenterY: 0,
      };
      const m = Mat.fromDecomposed(d);
      const p = Mat.applyToPoint(m, { x: 1, y: 0 });
      expect(p.x).toBeCloseTo(0);
      expect(p.y).toBeCloseTo(1);
    });
  });

  describe("toDecomposed", () => {
    it("should decompose identity matrix", () => {
      const m = Mat.Identity();
      const d = Mat.toDecomposed(m);
      expect(d.translateX).toBeCloseTo(0);
      expect(d.translateY).toBeCloseTo(0);
      expect(d.rotation).toBeCloseTo(0);
      expect(d.scaleX).toBeCloseTo(1);
      expect(d.scaleY).toBeCloseTo(1);
    });

    it("should decompose translation matrix", () => {
      const m = Mat.Translate(100, 50);
      const d = Mat.toDecomposed(m);
      expect(d.translateX).toBeCloseTo(100);
      expect(d.translateY).toBeCloseTo(50);
      expect(d.scaleX).toBeCloseTo(1);
      expect(d.scaleY).toBeCloseTo(1);
    });

    it("should decompose scale matrix", () => {
      const m = Mat.Scale(2, 3);
      const d = Mat.toDecomposed(m);
      expect(d.scaleX).toBeCloseTo(2);
      expect(d.scaleY).toBeCloseTo(3);
      expect(d.rotation).toBeCloseTo(0);
    });

    it("should decompose rotation matrix", () => {
      const m = Mat.Rotate(Math.PI / 2);
      const d = Mat.toDecomposed(m);
      expect(d.rotation).toBeCloseTo(90);
      expect(d.scaleX).toBeCloseTo(1);
      expect(d.scaleY).toBeCloseTo(1);
    });
  });

  describe("decomposed roundtrip", () => {
    it("should roundtrip translation + scale", () => {
      const original = {
        translateX: 50,
        translateY: 100,
        rotation: 0,
        scaleX: 2,
        scaleY: 1.5,
        skewX: 0,
        skewY: 0,
        tCenterX: 0,
        tCenterY: 0,
      };
      const m = Mat.fromDecomposed(original);
      const roundtrip = Mat.toDecomposed(m);

      expect(roundtrip.translateX).toBeCloseTo(original.translateX);
      expect(roundtrip.translateY).toBeCloseTo(original.translateY);
      expect(roundtrip.scaleX).toBeCloseTo(original.scaleX);
      expect(roundtrip.scaleY).toBeCloseTo(original.scaleY);
    });

    it("should roundtrip rotation", () => {
      const original = {
        translateX: 0,
        translateY: 0,
        rotation: 45,
        scaleX: 1,
        scaleY: 1,
        skewX: 0,
        skewY: 0,
        tCenterX: 0,
        tCenterY: 0,
      };
      const m = Mat.fromDecomposed(original);
      const roundtrip = Mat.toDecomposed(m);

      expect(roundtrip.rotation).toBeCloseTo(original.rotation);
    });
  });
});
