import { Curve, type CurveType, type QuadraticCurve } from "./Curve";
import { Vec2 } from "./Vec2";

/**
 * Approximates a connected span with one quadratic and exact endpoints.
 *
 * @remarks
 * Fits one control point by length-weighted least squares at sampled arc-length
 * parameters. Endpoint tangents are not constrained, and no error tolerance is
 * guaranteed. Inputs are not mutated; collapsed geometry stays collapsed.
 *
 * @param curves - Nonempty, connected curves in traversal order with finite coordinates.
 * @returns A quadratic in the input coordinate space, with one fitted control.
 * @throws {RangeError} When the input is empty, disconnected, or exceeds finite coordinate range.
 */
export function fitQuadratic(curves: readonly CurveType[]): QuadraticCurve {
  if (curves.length === 0) throw new RangeError("fitQuadratic requires a nonempty curve span");

  for (const [index, curve] of curves.entries()) {
    if (index > 0 && !Vec2.equals(curves[index - 1].p1, curve.p0)) {
      throw new RangeError("fitQuadratic requires connected curves");
    }

    const polygon = [curve.p0, curve.p1];
    switch (curve.type) {
      case "line":
        break;
      case "quadratic":
        polygon.push(curve.c);
        break;
      case "cubic":
        polygon.push(curve.c0, curve.c1);
        break;
    }
    if (polygon.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      throw new RangeError("fitQuadratic requires finite coordinates");
    }
  }

  const first = curves[0];
  const last = curves[curves.length - 1];
  if (curves.length === 1 && first.type === "quadratic") {
    return Curve.quadratic(first.p0, first.c, first.p1);
  }

  const samples = [first.p0];
  for (const curve of curves) samples.push(...Curve.sample(curve, 32).slice(1));

  const distances = samples.map((point, index) =>
    index === 0 ? 0 : Vec2.dist(point, samples[index - 1]),
  );
  const length = distances.reduce((sum, distance) => sum + distance, 0);
  if (length === 0) return Curve.quadratic(first.p0, first.p0, last.p1);
  if (!Number.isFinite(length)) {
    throw new RangeError("fitQuadratic span exceeds finite coordinate range");
  }

  const points = samples.map((point) => Vec2.scale(Vec2.sub(point, first.p0), 1 / length));
  const end = points[points.length - 1];
  let distance = 0;
  let aa = 0;
  let ar = { x: 0, y: 0 };
  for (let index = 1; index < points.length - 1; index++) {
    distance += distances[index];
    const t = distance / length;
    const a = 2 * (1 - t) * t;
    const weight = (distances[index] + distances[index + 1]) / (2 * length);
    const residual = Vec2.sub(points[index], Vec2.scale(end, t * t));
    aa += weight * a * a;
    ar = Vec2.add(ar, Vec2.scale(residual, weight * a));
  }

  const control = aa > 0 ? Vec2.scale(ar, 1 / aa) : Vec2.scale(end, 0.5);
  const fitted = Vec2.add(first.p0, Vec2.scale(control, length));
  if (!Number.isFinite(fitted.x) || !Number.isFinite(fitted.y)) {
    throw new RangeError("fitQuadratic control exceeds finite coordinate range");
  }

  return Curve.quadratic(first.p0, fitted, last.p1);
}
