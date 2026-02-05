/**
 * Vec2 - Lightweight 2D Vector Operations
 *
 * A functional namespace for 2D vector math operating on Point2D objects.
 * All operations are pure (return new objects) and work with the existing
 * Point2D type = {x, y}.
 *
 * Design principles:
 * - Pure functions (no mutation)
 * - Works with plain {x, y} objects
 * - No class instantiation overhead
 * - Tree-shakeable (import only what you need)
 *
 * @example
 * ```ts
 * import { Vec2 } from '@shift/geo';
 *
 * const a = { x: 1, y: 2 };
 * const b = { x: 3, y: 4 };
 *
 * const sum = Vec2.add(a, b);        // { x: 4, y: 6 }
 * const dist = Vec2.dist(a, b);      // 2.828...
 * const mid = Vec2.lerp(a, b, 0.5);  // { x: 2, y: 3 }
 * ```
 */

import type { Point2D } from "./types";

/**
 * Epsilon for floating point comparisons
 */
const EPSILON = 1e-10;

export const Vec2 = {
  // ============================================
  // Construction
  // ============================================

  /**
   * Create a new vector
   */
  create(x: number, y: number): Point2D {
    return { x, y };
  },

  /**
   * Create a zero vector
   */
  zero(): Point2D {
    return { x: 0, y: 0 };
  },

  /**
   * Create a unit vector in the X direction
   */
  unitX(): Point2D {
    return { x: 1, y: 0 };
  },

  /**
   * Create a unit vector in the Y direction
   */
  unitY(): Point2D {
    return { x: 0, y: 1 };
  },

  /**
   * Create a unit vector from an angle (in radians)
   */
  fromAngle(angle: number): Point2D {
    return { x: Math.cos(angle), y: Math.sin(angle) };
  },

  /**
   * Clone a vector
   */
  clone(v: Point2D): Point2D {
    return { x: v.x, y: v.y };
  },

  // ============================================
  // Basic Operations
  // ============================================

  /**
   * Add two vectors: a + b
   */
  add(a: Point2D, b: Point2D): Point2D {
    return { x: a.x + b.x, y: a.y + b.y };
  },

  /**
   * Subtract two vectors: a - b
   */
  sub(a: Point2D, b: Point2D): Point2D {
    return { x: a.x - b.x, y: a.y - b.y };
  },

  /**
   * Scale a vector by a scalar: v * s
   */
  scale(v: Point2D, s: number): Point2D {
    return { x: v.x * s, y: v.y * s };
  },

  /**
   * Negate a vector: -v
   */
  negate(v: Point2D): Point2D {
    return { x: -v.x, y: -v.y };
  },

  /**
   * Component-wise multiplication: a * b
   */
  mul(a: Point2D, b: Point2D): Point2D {
    return { x: a.x * b.x, y: a.y * b.y };
  },

  /**
   * Component-wise division: a / b
   */
  div(a: Point2D, b: Point2D): Point2D {
    return { x: a.x / b.x, y: a.y / b.y };
  },

  // ============================================
  // Products
  // ============================================

  /**
   * Dot product: a · b
   * Returns a scalar representing the projection of a onto b times the length of b.
   * When both vectors are normalized, this equals cos(angle between them).
   */
  dot(a: Point2D, b: Point2D): number {
    return a.x * b.x + a.y * b.y;
  },

  /**
   * 2D Cross product (also called perp dot product): a × b
   * Returns a scalar representing the signed area of the parallelogram formed by a and b.
   * Positive if b is counter-clockwise from a, negative if clockwise.
   * When both vectors are normalized, this equals sin(angle from a to b).
   */
  cross(a: Point2D, b: Point2D): number {
    return a.x * b.y - a.y * b.x;
  },

  // ============================================
  // Length & Distance
  // ============================================

  /**
   * Length (magnitude) of a vector
   */
  len(v: Point2D): number {
    return Math.hypot(v.x, v.y);
  },

  /**
   * Squared length of a vector (avoids sqrt, useful for comparisons)
   */
  lenSq(v: Point2D): number {
    return v.x * v.x + v.y * v.y;
  },

  /**
   * Distance between two points
   */
  dist(a: Point2D, b: Point2D): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
  },

  /**
   * Squared distance between two points (avoids sqrt, useful for comparisons)
   */
  distSq(a: Point2D, b: Point2D): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return dx * dx + dy * dy;
  },

  /**
   * Manhattan distance between two points: |dx| + |dy|
   */
  manhattanDist(a: Point2D, b: Point2D): number {
    return Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  },

  // ============================================
  // Normalization
  // ============================================

  /**
   * Normalize a vector to unit length.
   * Returns zero vector if input has zero length.
   */
  normalize(v: Point2D): Point2D {
    const len = Math.hypot(v.x, v.y);
    if (len < EPSILON) {
      return { x: 0, y: 0 };
    }
    return { x: v.x / len, y: v.y / len };
  },

  /**
   * Set the length of a vector while preserving direction.
   */
  setLen(v: Point2D, length: number): Point2D {
    const currentLen = Math.hypot(v.x, v.y);
    if (currentLen < EPSILON) {
      return { x: 0, y: 0 };
    }
    const scale = length / currentLen;
    return { x: v.x * scale, y: v.y * scale };
  },

  /**
   * Limit the length of a vector to a maximum value.
   */
  clampLen(v: Point2D, maxLen: number): Point2D {
    const lenSq = v.x * v.x + v.y * v.y;
    if (lenSq > maxLen * maxLen) {
      const scale = maxLen / Math.sqrt(lenSq);
      return { x: v.x * scale, y: v.y * scale };
    }
    return { x: v.x, y: v.y };
  },

  // ============================================
  // Interpolation
  // ============================================

  /**
   * Linear interpolation between two points: a + t * (b - a)
   * @param t - Interpolation factor (0 = a, 1 = b)
   */
  lerp(a: Point2D, b: Point2D, t: number): Point2D {
    return {
      x: a.x + t * (b.x - a.x),
      y: a.y + t * (b.y - a.y),
    };
  },

  /**
   * Linear interpolation with integer rounding (useful for pixel coordinates)
   */
  lerpInt(a: Point2D, b: Point2D, t: number): Point2D {
    return {
      x: Math.round(a.x + t * (b.x - a.x)),
      y: Math.round(a.y + t * (b.y - a.y)),
    };
  },

  // ============================================
  // Geometric Operations
  // ============================================

  /**
   * Mirror a point across an anchor point.
   * Returns a point such that anchor is the midpoint between point and result.
   */
  mirror(point: Point2D, anchor: Point2D): Point2D {
    return {
      x: 2 * anchor.x - point.x,
      y: 2 * anchor.y - point.y,
    };
  },

  /**
   * Project vector a onto vector b.
   * Returns the component of a in the direction of b.
   */
  project(a: Point2D, onto: Point2D): Point2D {
    const dotProduct = a.x * onto.x + a.y * onto.y;
    const lenSq = onto.x * onto.x + onto.y * onto.y;
    if (lenSq < EPSILON) {
      return { x: 0, y: 0 };
    }
    const scale = dotProduct / lenSq;
    return { x: onto.x * scale, y: onto.y * scale };
  },

  /**
   * Get the rejection of a from b (component of a perpendicular to b).
   * a = project(a, b) + reject(a, b)
   */
  reject(a: Point2D, from: Point2D): Point2D {
    const proj = Vec2.project(a, from);
    return { x: a.x - proj.x, y: a.y - proj.y };
  },

  /**
   * Reflect a vector across a normal.
   * The normal should be a unit vector.
   */
  reflect(v: Point2D, normal: Point2D): Point2D {
    const dot2 = 2 * (v.x * normal.x + v.y * normal.y);
    return {
      x: v.x - dot2 * normal.x,
      y: v.y - dot2 * normal.y,
    };
  },

  /**
   * Get the perpendicular vector (rotated 90° counter-clockwise).
   */
  perp(v: Point2D): Point2D {
    return { x: -v.y, y: v.x };
  },

  /**
   * Get the perpendicular vector (rotated 90° clockwise).
   */
  perpCW(v: Point2D): Point2D {
    return { x: v.y, y: -v.x };
  },

  // ============================================
  // Rotation & Angles
  // ============================================

  /**
   * Get the angle of a vector from the positive X axis (in radians).
   * Returns value in range [-π, π].
   */
  angle(v: Point2D): number {
    return Math.atan2(v.y, v.x);
  },

  /**
   * Get the angle from point a to point b (in radians).
   */
  angleTo(from: Point2D, to: Point2D): number {
    return Math.atan2(to.y - from.y, to.x - from.x);
  },

  /**
   * Get the signed angle between two vectors (in radians).
   * Positive if b is counter-clockwise from a.
   */
  angleBetween(a: Point2D, b: Point2D): number {
    return Math.atan2(Vec2.cross(a, b), Vec2.dot(a, b));
  },

  /**
   * Rotate a vector by an angle (in radians).
   */
  rotate(v: Point2D, angle: number): Point2D {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x: v.x * cos - v.y * sin,
      y: v.x * sin + v.y * cos,
    };
  },

  /**
   * Rotate a point around an anchor by an angle (in radians).
   */
  rotateAround(point: Point2D, anchor: Point2D, angle: number): Point2D {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    return {
      x: anchor.x + dx * cos - dy * sin,
      y: anchor.y + dx * sin + dy * cos,
    };
  },

  // ============================================
  // Predicates & Comparisons
  // ============================================

  /**
   * Check if two vectors are approximately equal.
   */
  equals(a: Point2D, b: Point2D, epsilon: number = EPSILON): boolean {
    return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
  },

  /**
   * Check if a vector is approximately zero.
   */
  isZero(v: Point2D, epsilon: number = EPSILON): boolean {
    return Math.abs(v.x) < epsilon && Math.abs(v.y) < epsilon;
  },

  /**
   * Check if two vectors are parallel (pointing in same or opposite direction).
   */
  isParallel(a: Point2D, b: Point2D, epsilon: number = EPSILON): boolean {
    return Math.abs(Vec2.cross(a, b)) < epsilon;
  },

  /**
   * Check if two vectors are perpendicular.
   */
  isPerpendicular(a: Point2D, b: Point2D, epsilon: number = EPSILON): boolean {
    return Math.abs(Vec2.dot(a, b)) < epsilon;
  },

  /**
   * Check if point b is within a given radius of point a.
   */
  isWithin(a: Point2D, b: Point2D, radius: number): boolean {
    return Vec2.dist(a, b) < radius;
  },

  // ============================================
  // Utility
  // ============================================

  /**
   * Component-wise minimum of two vectors.
   */
  min(a: Point2D, b: Point2D): Point2D {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
  },

  /**
   * Component-wise maximum of two vectors.
   */
  max(a: Point2D, b: Point2D): Point2D {
    return { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
  },

  /**
   * Component-wise absolute value.
   */
  abs(v: Point2D): Point2D {
    return { x: Math.abs(v.x), y: Math.abs(v.y) };
  },

  /**
   * Component-wise floor.
   */
  floor(v: Point2D): Point2D {
    return { x: Math.floor(v.x), y: Math.floor(v.y) };
  },

  /**
   * Component-wise ceil.
   */
  ceil(v: Point2D): Point2D {
    return { x: Math.ceil(v.x), y: Math.ceil(v.y) };
  },

  /**
   * Component-wise round.
   */
  round(v: Point2D): Point2D {
    return { x: Math.round(v.x), y: Math.round(v.y) };
  },

  /**
   * Clamp each component to a range.
   */
  clamp(v: Point2D, min: Point2D, max: Point2D): Point2D {
    return {
      x: Math.max(min.x, Math.min(max.x, v.x)),
      y: Math.max(min.y, Math.min(max.y, v.y)),
    };
  },

  /**
   * Get the midpoint between two points.
   */
  midpoint(a: Point2D, b: Point2D): Point2D {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  },

  /**
   * Convert to array [x, y].
   */
  toArray(v: Point2D): [number, number] {
    return [v.x, v.y];
  },

  /**
   * Create from array [x, y].
   */
  fromArray(arr: [number, number]): Point2D {
    return { x: arr[0], y: arr[1] };
  },

  // ============================================
  // Snapping
  // ============================================

  /**
   * Constrain a delta vector to the dominant axis (horizontal or vertical).
   * Returns a vector with only the x or y component, whichever has larger absolute value.
   */
  constrainToAxis(delta: Point2D): Point2D {
    if (Math.abs(delta.x) >= Math.abs(delta.y)) {
      return { x: delta.x, y: 0 };
    }
    return { x: 0, y: delta.y };
  },

  /**
   * Snap an angle to the nearest increment.
   * @param angle - The angle in radians
   * @param increment - The snap increment in radians (default: π/4 = 45°)
   */
  snapAngle(angle: number, increment: number = Math.PI / 4): number {
    return Math.round(angle / increment) * increment;
  },

  /**
   * Snap a vector to the nearest angle increment while preserving its length.
   * @param v - The vector to snap
   * @param increment - The angle snap increment in radians (default: π/4 = 45°)
   */
  snapToAngle(v: Point2D, increment: number = Math.PI / 4): Point2D {
    const len = Vec2.len(v);
    if (len < EPSILON) return { x: 0, y: 0 };
    const angle = Vec2.angle(v);
    const snappedAngle = Math.round(angle / increment) * increment;
    return { x: len * Math.cos(snappedAngle), y: len * Math.sin(snappedAngle) };
  },

  /**
   * Snap an angle with hysteresis - sticks to previous snap until threshold exceeded.
   * @param angle - The angle in radians
   * @param previousSnapped - The previously snapped angle (null if none)
   * @param increment - The snap increment in radians (default: π/4 = 45°)
   * @param hysteresisFactor - Fraction of increment needed to break free (default: 0.4 = 40%)
   */
  snapAngleWithHysteresis(
    angle: number,
    previousSnapped: number | null,
    increment: number = Math.PI / 4,
    hysteresisFactor: number = 0.4,
  ): number {
    if (previousSnapped !== null) {
      const threshold = increment * hysteresisFactor;
      if (Math.abs(angle - previousSnapped) <= threshold) {
        return previousSnapped;
      }
    }
    return Math.round(angle / increment) * increment;
  },

  /**
   * Snap a vector to angle increments with hysteresis.
   * Returns both the snapped position and the snapped angle (for tracking).
   * @param v - The vector to snap
   * @param previousSnapped - The previously snapped angle (null if none)
   * @param increment - The angle snap increment in radians (default: π/4 = 45°)
   * @param hysteresisFactor - Fraction of increment needed to break free (default: 0.4 = 40%)
   */
  snapToAngleWithHysteresis(
    v: Point2D,
    previousSnapped: number | null,
    increment: number = Math.PI / 4,
    hysteresisFactor: number = 0.4,
  ): { position: Point2D; snappedAngle: number } {
    const len = Vec2.len(v);
    if (len < EPSILON) return { position: { x: 0, y: 0 }, snappedAngle: 0 };

    const rawAngle = Vec2.angle(v);
    const snappedAngle = Vec2.snapAngleWithHysteresis(
      rawAngle,
      previousSnapped,
      increment,
      hysteresisFactor,
    );

    return {
      position: { x: len * Math.cos(snappedAngle), y: len * Math.sin(snappedAngle) },
      snappedAngle,
    };
  },

  /**
   * Constrain a delta to an axis with hysteresis - sticks to previous axis until threshold exceeded.
   * @param delta - The delta vector to constrain
   * @param previousAxis - The previously constrained axis (null if none)
   * @param threshold - Ratio (0-1) of dominance needed to switch axes (default: 0.7 = 70%)
   */
  constrainToAxisWithHysteresis(
    delta: Point2D,
    previousAxis: "x" | "y" | null,
    threshold: number = 0.7,
  ): { delta: Point2D; axis: "x" | "y" } {
    const absX = Math.abs(delta.x);
    const absY = Math.abs(delta.y);

    let axis: "x" | "y";

    if (previousAxis === null) {
      axis = absX >= absY ? "x" : "y";
    } else {
      const total = absX + absY + EPSILON;
      const xRatio = absX / total;
      const yRatio = absY / total;

      if (previousAxis === "x" && yRatio > threshold) {
        axis = "y";
      } else if (previousAxis === "y" && xRatio > threshold) {
        axis = "x";
      } else {
        axis = previousAxis;
      }
    }

    return {
      delta: axis === "x" ? { x: delta.x, y: 0 } : { x: 0, y: delta.y },
      axis,
    };
  },
} as const;
