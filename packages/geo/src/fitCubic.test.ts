import { describe, expect, it } from "vitest";
import { Curve, type CubicCurve } from "./Curve";
import { Vec2 } from "./Vec2";

const arch = Curve.cubic({ x: 0, y: 0 }, { x: 0, y: 160 }, { x: 200, y: 160 }, { x: 200, y: 0 });
const inflection = Curve.cubic(
  { x: 0, y: 0 },
  { x: 50, y: 150 },
  { x: 150, y: -150 },
  { x: 200, y: 0 },
);

function maximumError(original: CubicCurve, fitted: CubicCurve): number {
  // Exhaustive polyline distance is independent of the Newton projection used
  // by fitting and hit testing, including on loops and near zero derivatives.
  return Math.max(
    ...[
      [original, fitted],
      [fitted, original],
    ].flatMap(([source, target]) => {
      const polygon = Curve.sample(target, 2048);
      const edges = polygon.slice(1).map((point, index) => Curve.line(polygon[index], point));
      return Curve.sample(source, 100).map((point) =>
        Math.min(...edges.map((edge) => Curve.distanceTo(edge, point))),
      );
    }),
  );
}

describe("one cubic approximates the original connected span", () => {
  it.each([0.17, 0.5, 0.83])("recovers an arch split at %s", (t) => {
    const fitted = Curve.fitCubic(Curve.splitAt(arch, t));
    expect(fitted.p0).toEqual(arch.p0);
    expect(fitted.p1).toEqual(arch.p1);
    expect(maximumError(arch, fitted)).toBeLessThan(0.1);
    expect(Vec2.cross(Curve.tangentAt(arch, 0), Curve.tangentAt(fitted, 0))).toBeCloseTo(0);
    expect(Vec2.cross(Curve.tangentAt(arch, 1), Curve.tangentAt(fitted, 1))).toBeCloseTo(0);
  });

  it("recovers an inflection without jumping to another curve branch", () => {
    const fitted = Curve.fitCubic(Curve.splitAt(inflection, 0.37));
    expect(maximumError(inflection, fitted)).toBeLessThan(0.1);
    expect(Vec2.dot(Curve.tangentAt(inflection, 0), Curve.tangentAt(fitted, 0))).toBeGreaterThan(0);
  });

  it("fits several segments together instead of successively fitting pairs", () => {
    const [left, right] = Curve.splitAt(arch, 0.4);
    const fitted = Curve.fitCubic([...Curve.splitAt(left, 0.3), ...Curve.splitAt(right, 0.6)]);
    expect(maximumError(arch, fitted)).toBeLessThan(0.1);
  });

  it("preserves a single cubic exactly", () => {
    expect(Curve.fitCubic([inflection])).toEqual(inflection);
  });

  it("keeps a collinear span on its line", () => {
    const fitted = Curve.fitCubic([
      Curve.line({ x: 0, y: 0 }, { x: 25, y: 0 }),
      Curve.line({ x: 25, y: 0 }, { x: 100, y: 0 }),
    ]);
    expect(
      Curve.sample(fitted, 10).every((point) => point.y === 0 && point.x >= 0 && point.x <= 100),
    ).toBe(true);
    expect(fitted.p1).toEqual({ x: 100, y: 0 });
  });

  it("returns finite controls for a singular solve with parallel tangent rays", () => {
    const fitted = Curve.fitCubic([
      Curve.cubic({ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 20, y: 100 }, { x: 50, y: 100 }),
      Curve.cubic({ x: 50, y: 100 }, { x: 80, y: 100 }, { x: 20, y: 0 }, { x: 100, y: 0 }),
    ]);
    expect([fitted.c0.x, fitted.c0.y, fitted.c1.x, fitted.c1.y].every(Number.isFinite)).toBe(true);
    expect(fitted.c0.y).toBe(0);
    expect(fitted.c1.y).toBe(0);
  });

  it("derives endpoint directions when authored handles have zero length", () => {
    const original = Curve.cubic(
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 100 },
    );
    const fitted = Curve.fitCubic(Curve.splitAt(original, 0.5));
    expect(maximumError(original, fitted)).toBeLessThan(0.1);
    expect(fitted.c0.x).toBeCloseTo(fitted.c0.y);
    expect(fitted.c1.x).toBeCloseTo(fitted.c1.y);
  });

  it("retains tangent directions from tiny nonzero endpoint handles", () => {
    const original = Curve.cubic(
      { x: 0, y: 0 },
      { x: 1e-8, y: 0 },
      { x: 200, y: 100 },
      { x: 200, y: 0 },
    );
    const fitted = Curve.fitCubic(Curve.splitAt(original, 0.5));
    expect(fitted.c0.x).toBeGreaterThan(0);
    expect(fitted.c0.y).toBe(0);
    expect(fitted.c1.x).toBe(200);
    expect(fitted.c1.y).toBeGreaterThan(0);
    expect(maximumError(original, fitted)).toBeLessThan(0.1);
  });

  it("ignores collapsed segments without losing the nonempty span", () => {
    const fitted = Curve.fitCubic([
      Curve.line(arch.p0, arch.p0),
      ...Curve.splitAt(arch, 0.5),
      Curve.line(arch.p1, arch.p1),
    ]);
    expect(maximumError(arch, fitted)).toBeLessThan(0.1);
  });

  it("fits the same geometry when traversal is reversed", () => {
    const reversed = Curve.cubic(inflection.p1, inflection.c1, inflection.c0, inflection.p0);
    const forward = Curve.fitCubic(Curve.splitAt(inflection, 0.37));
    const backward = Curve.fitCubic(Curve.splitAt(reversed, 0.63));
    expect(Vec2.dist(forward.c0, backward.c1)).toBeLessThan(1e-6);
    expect(Vec2.dist(forward.c1, backward.c0)).toBeLessThan(1e-6);
  });

  it("does not collapse a nonempty loop whose endpoints coincide", () => {
    const loop = Curve.cubic(
      { x: 0, y: 0 },
      { x: 150, y: 200 },
      { x: -150, y: 200 },
      { x: 0, y: 0 },
    );
    const fitted = Curve.fitCubic(Curve.splitAt(loop, 0.5));
    expect(Vec2.dist(fitted.c0, loop.c0)).toBeLessThan(0.001);
    expect(Vec2.dist(fitted.c1, loop.c1)).toBeLessThan(0.001);
    expect(Curve.length(fitted)).toBeGreaterThan(100);
  });

  it("returns a collapsed cubic for coincident source geometry", () => {
    const point = { x: 15, y: 25 };
    expect(Curve.fitCubic([Curve.line(point, point), Curve.line(point, point)])).toEqual(
      Curve.cubic(point, point, point, point),
    );
  });

  it.each([1e-6, 1e6])("normalizes the solve at scale %s", (scale) => {
    const offset = { x: 5000, y: -7000 };
    const original = Curve.cubic(
      Vec2.scale(Vec2.add(arch.p0, offset), scale),
      Vec2.scale(Vec2.add(arch.c0, offset), scale),
      Vec2.scale(Vec2.add(arch.c1, offset), scale),
      Vec2.scale(Vec2.add(arch.p1, offset), scale),
    );
    const fitted = Curve.fitCubic(Curve.splitAt(original, 0.37));
    expect(Vec2.dist(fitted.c0, original.c0) / scale).toBeLessThan(0.5);
    expect(Vec2.dist(fitted.c1, original.c1) / scale).toBeLessThan(0.5);
  });

  it("rejects empty, disconnected and nonfinite input", () => {
    expect(() => Curve.fitCubic([])).toThrow(RangeError);
    expect(() => Curve.fitCubic([arch, arch])).toThrow(RangeError);
    expect(() => Curve.fitCubic([Curve.line({ x: NaN, y: 0 }, { x: 0, y: 0 })])).toThrow(
      RangeError,
    );
  });
});
