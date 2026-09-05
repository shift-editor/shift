import { Curve, type CubicCurve, type CurveType } from "./Curve";
import type { Point2D } from "./types";
import { Vec2 } from "./Vec2";

/**
 * Approximates a connected curve span with one endpoint-tangent-constrained cubic.
 *
 * @remarks
 * Fits from the original geometry without mutating it or subdividing the result.
 * Sample parameters remain ordered during refinement. Coordinates are normalized
 * for the solve; surviving endpoints are returned exactly. A poor fit retains
 * the best finite candidate, with handle lengths bounded by twice the sampled
 * source length. Zero endpoint derivatives use the first nonzero control-polygon
 * direction, and a collapsed span returns a collapsed cubic.
 *
 * @param curves - Nonempty, connected curves in traversal order with finite coordinates.
 * @returns One new cubic approximating the whole span in the input coordinate space.
 * @throws {RangeError} When the input is empty, disconnected, or nonfinite.
 */
export function fitCubic(curves: readonly CurveType[]): CubicCurve {
  if (curves.length === 0) throw new RangeError("fitCubic requires a nonempty curve span");

  const polygon: Point2D[] = [];
  for (const [index, curve] of curves.entries()) {
    if (index > 0 && !Vec2.equals(curves[index - 1].p1, curve.p0)) {
      throw new RangeError("fitCubic requires connected curves");
    }

    switch (curve.type) {
      case "line":
        polygon.push(curve.p0, curve.p1);
        break;
      case "quadratic":
        polygon.push(curve.p0, curve.c, curve.p1);
        break;
      case "cubic":
        polygon.push(curve.p0, curve.c0, curve.c1, curve.p1);
        break;
    }
  }

  if (polygon.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new RangeError("fitCubic requires finite coordinates");
  }

  const first = curves[0];
  const last = curves[curves.length - 1];
  if (curves.length === 1) {
    switch (first.type) {
      case "cubic":
        return Curve.cubic(first.p0, first.c0, first.c1, first.p1);
      case "quadratic":
        return Curve.quadraticToCubic(first);
      case "line":
        return Curve.cubic(
          first.p0,
          Vec2.lerp(first.p0, first.p1, 1 / 3),
          Vec2.lerp(first.p0, first.p1, 2 / 3),
          first.p1,
        );
    }
  }

  const samples = [first.p0];
  for (const curve of curves) samples.push(...Curve.sample(curve, 32).slice(1));

  const distances = samples.map((point, index) =>
    index === 0 ? 0 : Vec2.dist(point, samples[index - 1]),
  );
  const length = distances.reduce((sum, distance) => sum + distance, 0);
  if (length === 0) return Curve.cubic(first.p0, first.p0, last.p1, last.p1);
  if (!Number.isFinite(length))
    throw new RangeError("fitCubic span exceeds finite coordinate range");

  const points = samples.map((point) => Vec2.scale(Vec2.sub(point, first.p0), 1 / length));
  const start = points[0];
  const end = points[points.length - 1];
  const startDirection = polygon
    .map((point) => Vec2.scale(Vec2.sub(point, first.p0), 1 / length))
    .find((direction) => Vec2.len(direction) > 0);
  const endDirection = [...polygon]
    .reverse()
    .map((point) => Vec2.scale(Vec2.sub(point, last.p1), 1 / length))
    .find((direction) => Vec2.len(direction) > 0);
  // These directions have already been checked for zero. Normalizing with a
  // geometric epsilon would erase the direction of a short but authored handle.
  const startTangent = startDirection
    ? {
        x: startDirection.x / Vec2.len(startDirection),
        y: startDirection.y / Vec2.len(startDirection),
      }
    : Vec2.normalize(Vec2.sub(end, start));
  const endTangent = endDirection
    ? { x: endDirection.x / Vec2.len(endDirection), y: endDirection.y / Vec2.len(endDirection) }
    : Vec2.normalize(Vec2.sub(start, end));
  const weights = distances.map(
    (distance, index) => (distance + (distances[index + 1] ?? 0)) / (2 * length),
  );
  let distance = 0;
  let parameters = distances.map((step) => {
    distance += step;
    return distance / length;
  });
  parameters[parameters.length - 1] = 1;

  let best = Curve.cubic(
    start,
    Vec2.add(start, Vec2.scale(startTangent, 1 / 3)),
    Vec2.add(end, Vec2.scale(endTangent, 1 / 3)),
    end,
  );
  let bestError = Infinity;

  for (let iteration = 0; iteration < 80; iteration++) {
    let aa = 0;
    let ab = 0;
    let bb = 0;
    let ar = 0;
    let br = 0;

    for (let index = 1; index < points.length - 1; index++) {
      const t = parameters[index];
      const a = Vec2.scale(startTangent, 3 * (1 - t) ** 2 * t);
      const b = Vec2.scale(endTangent, 3 * (1 - t) * t ** 2);
      const base = Vec2.lerp(start, end, t ** 3 + 3 * (1 - t) * t ** 2);
      const residual = Vec2.sub(points[index], base);
      const weight = weights[index];
      aa += weight * Vec2.dot(a, a);
      ab += weight * Vec2.dot(a, b);
      bb += weight * Vec2.dot(b, b);
      ar += weight * Vec2.dot(a, residual);
      br += weight * Vec2.dot(b, residual);
    }

    // Solve the box-constrained two-variable least-squares problem: its
    // minimum is either the unconstrained solution or on one of four edges.
    const candidates = [[1 / 3, 1 / 3]];
    const determinant = aa * bb - ab * ab;
    if (determinant > 1e-12 * aa * bb) {
      candidates.push([(ar * bb - br * ab) / determinant, (br * aa - ar * ab) / determinant]);
    }
    for (const bound of [1e-8, 2]) {
      candidates.push([
        bound,
        Math.max(1e-8, Math.min(2, bb > 0 ? (br - ab * bound) / bb : 1 / 3)),
      ]);
      candidates.push([
        Math.max(1e-8, Math.min(2, aa > 0 ? (ar - ab * bound) / aa : 1 / 3)),
        bound,
      ]);
    }

    let curve = best;
    let error = Infinity;
    for (const [alpha, beta] of candidates) {
      if (
        !Number.isFinite(alpha) ||
        !Number.isFinite(beta) ||
        alpha < 1e-8 ||
        beta < 1e-8 ||
        alpha > 2 ||
        beta > 2
      )
        continue;

      const candidate = Curve.cubic(
        start,
        Vec2.add(start, Vec2.scale(startTangent, alpha)),
        Vec2.add(end, Vec2.scale(endTangent, beta)),
        end,
      );
      const candidateError = points.reduce(
        (sum, point, index) =>
          sum + weights[index] * Vec2.distSq(point, Curve.pointAt(candidate, parameters[index])),
        0,
      );
      if (candidateError < error) {
        error = candidateError;
        curve = candidate;
      }
    }

    if (error < bestError) {
      bestError = error;
      best = curve;
    }
    if (error < 1e-18) break;

    // Safeguarded Newton projection. Each sample stays inside its own ordered
    // interval; accepting only improvements avoids branch jumps on S-curves.
    const next = [...parameters];
    let movement = 0;
    for (let index = 1; index < points.length - 1; index++) {
      const t = parameters[index];
      const residual = Vec2.sub(Curve.pointAt(curve, t), points[index]);
      const derivative = Curve.tangentAt(curve, t);
      const secondDerivative = Vec2.scale(
        Vec2.lerp(
          Vec2.add(Vec2.sub(curve.c1, Vec2.scale(curve.c0, 2)), curve.p0),
          Vec2.add(Vec2.sub(curve.p1, Vec2.scale(curve.c1, 2)), curve.c0),
          t,
        ),
        6,
      );
      const denominator = Vec2.dot(derivative, derivative) + Vec2.dot(residual, secondDerivative);
      if (Math.abs(denominator) < 1e-14) continue;

      const lower = (parameters[index - 1] + t) / 2;
      const upper = (t + parameters[index + 1]) / 2;
      let updated = Math.max(
        lower,
        Math.min(upper, t - Vec2.dot(residual, derivative) / denominator),
      );
      for (let step = 0; step < 8; step++) {
        if (Vec2.distSq(Curve.pointAt(curve, updated), points[index]) <= Vec2.lenSq(residual))
          break;
        updated = (updated + t) / 2;
      }
      if (Vec2.distSq(Curve.pointAt(curve, updated), points[index]) > Vec2.lenSq(residual))
        continue;

      next[index] = updated;
      movement = Math.max(movement, Math.abs(updated - t));
    }
    parameters = next;
    if (movement < 1e-12) break;
  }

  return Curve.cubic(
    first.p0,
    Vec2.add(first.p0, Vec2.scale(best.c0, length)),
    Vec2.add(first.p0, Vec2.scale(best.c1, length)),
    last.p1,
  );
}
