import { describe, expect, it } from "vitest";
import { Curve } from "./Curve";
import { Vec2 } from "./Vec2";

const arch = Curve.quadratic({ x: 0, y: 0 }, { x: 100, y: 200 }, { x: 200, y: 0 });

describe("quadratic fitting keeps exact endpoints and a single control", () => {
  it.each([0.2, 0.5, 0.8])("approximates an arch split at %s", (t) => {
    const fitted = Curve.fitQuadratic(Curve.splitAt(arch, t));
    expect(fitted.type).toBe("quadratic");
    expect(fitted.p0).toEqual(arch.p0);
    expect(fitted.p1).toEqual(arch.p1);
    expect(
      Math.max(
        ...Curve.sample(arch, 40).map((point, index) =>
          Vec2.dist(point, Curve.pointAt(fitted, index / 40)),
        ),
      ),
    ).toBeLessThan(20);
  });

  it("preserves a single quadratic exactly", () => {
    expect(Curve.fitQuadratic([arch])).toEqual(arch);
  });

  it("fits lines and quadratics together without constraining incompatible tangents", () => {
    const fitted = Curve.fitQuadratic([arch, Curve.line(arch.p1, { x: 300, y: 0 })]);
    expect(fitted.p0).toEqual(arch.p0);
    expect(fitted.p1).toEqual({ x: 300, y: 0 });
    expect(fitted.c.y).toBeGreaterThan(0);
    expect([fitted.c.x, fitted.c.y].every(Number.isFinite)).toBe(true);
  });

  it("keeps collinear samples on their line", () => {
    const fitted = Curve.fitQuadratic([
      Curve.line({ x: 0, y: 0 }, { x: 25, y: 0 }),
      Curve.line({ x: 25, y: 0 }, { x: 100, y: 0 }),
    ]);
    expect(fitted.c.x).toBeCloseTo(50);
    expect(fitted.c.y).toBe(0);
  });

  it("keeps coincident geometry collapsed", () => {
    const point = { x: 10, y: 20 };
    expect(Curve.fitQuadratic([Curve.line(point, point), Curve.line(point, point)])).toEqual(
      Curve.quadratic(point, point, point),
    );
  });

  it.each([1e-6, 1e6])("fits consistently after translation and scaling by %s", (scale) => {
    const offset = { x: 5000, y: -7000 };
    const original = Curve.quadratic(
      Vec2.scale(Vec2.add(arch.p0, offset), scale),
      Vec2.scale(Vec2.add(arch.c, offset), scale),
      Vec2.scale(Vec2.add(arch.p1, offset), scale),
    );
    const fitted = Curve.fitQuadratic(Curve.splitAt(original, 0.3));
    const expected = Curve.fitQuadratic(Curve.splitAt(arch, 0.3));
    expect(Vec2.dist(Vec2.sub(Vec2.scale(fitted.c, 1 / scale), offset), expected.c)).toBeLessThan(
      1e-6,
    );
  });

  it("rejects empty, disconnected and nonfinite geometry", () => {
    expect(() => Curve.fitQuadratic([])).toThrow(RangeError);
    expect(() => Curve.fitQuadratic([arch, arch])).toThrow(RangeError);
    expect(() => Curve.fitQuadratic([Curve.quadratic(arch.p0, { x: NaN, y: 0 }, arch.p1)])).toThrow(
      RangeError,
    );
  });
});
