/**
 * Transform - Pure geometry transformation functions.
 *
 * All functions are pure (no side effects) and operate on arrays of points.
 * These are the building blocks for transform commands and tools.
 *
 * @example
 * ```ts
 * import { Transform } from '@/lib/transform';
 *
 * // Rotate points 90° around center
 * const rotated = Transform.rotatePoints(points, Math.PI / 2, center);
 *
 * // Scale points 2x from origin
 * const scaled = Transform.scalePoints(points, 2, 2, origin);
 *
 * // Flip horizontally
 * const flipped = Transform.reflectPoints(points, 'horizontal', center);
 * ```
 */

import { Mat, type MatModel, type Point2D } from "@shift/geo";
import type { ReflectAxis } from "./types";

type Coordinate = { readonly x: number; readonly y: number };

/**
 * Pure transformation functions for geometry manipulation.
 */
export const Transform = {
  /**
   * Rotate points around an origin.
   *
   * @param points - Points to transform
   * @param angle - Rotation angle in radians (positive = counter-clockwise)
   * @param origin - Center of rotation
   * @returns New array of transformed points (original unchanged)
   */
  rotatePoints<T extends Coordinate>(points: readonly T[], angle: number, origin: Point2D): T[] {
    return Transform.applyMatrix(points, Mat.Rotate(angle), origin);
  },

  /**
   * Scale points from an origin.
   *
   * @param points - Points to transform
   * @param sx - Scale factor for X axis (1 = no change, 2 = double, 0.5 = half)
   * @param sy - Scale factor for Y axis
   * @param origin - Center of scaling
   * @returns New array of transformed points (original unchanged)
   */
  scalePoints<T extends Coordinate>(
    points: readonly T[],
    sx: number,
    sy: number,
    origin: Point2D,
  ): T[] {
    return Transform.applyMatrix(points, Mat.Scale(sx, sy), origin);
  },

  /**
   * Reflect points across an axis through the origin.
   *
   * @param points - Points to transform
   * @param axis - Axis of reflection
   * @param origin - Point the axis passes through
   * @returns New array of transformed points (original unchanged)
   */
  reflectPoints<T extends Coordinate>(
    points: readonly T[],
    axis: ReflectAxis,
    origin: Point2D,
  ): T[] {
    const matrix =
      axis === "horizontal"
        ? Mat.ReflectHorizontal()
        : axis === "vertical"
          ? Mat.ReflectVertical()
          : Mat.ReflectAxis(axis.angle);
    return Transform.applyMatrix(points, matrix, origin);
  },

  /**
   * Apply an arbitrary affine transformation matrix to points.
   * The transform is applied relative to an origin.
   *
   * @param points - Points to transform
   * @param matrix - Transformation matrix
   * @param origin - Center of transformation (default: {0, 0})
   * @returns New array of transformed points (original unchanged)
   */
  applyMatrix<T extends Coordinate>(
    points: readonly T[],
    matrix: MatModel,
    origin: Point2D = { x: 0, y: 0 },
  ): T[] {
    // Build composite: Translate(-origin) → Matrix → Translate(origin)
    // Matrix multiplication order (right to left): fromOrigin × matrix × toOrigin
    const toOrigin = Mat.Translate(-origin.x, -origin.y);
    const fromOrigin = Mat.Translate(origin.x, origin.y);
    const composite = Mat.Compose(Mat.Compose(fromOrigin, matrix), toOrigin);

    return points.map((p) => {
      const transformed = Mat.applyToPoint(composite, p);
      return { ...p, x: transformed.x, y: transformed.y };
    });
  },

  /**
   * Pre-built transformation matrices for common operations.
   */
  matrices: {
    rotate: Mat.Rotate,
    scale: Mat.Scale,
    reflectHorizontal: Mat.ReflectHorizontal,
    reflectVertical: Mat.ReflectVertical,
    reflectAxis: Mat.ReflectAxis,
  },

  /**
   * Rotate points by 90 degrees counter-clockwise.
   */
  rotate90CCW<T extends Coordinate>(points: readonly T[], origin: Point2D): T[] {
    return Transform.rotatePoints(points, Math.PI / 2, origin);
  },

  /**
   * Rotate points by 90 degrees clockwise.
   */
  rotate90CW<T extends Coordinate>(points: readonly T[], origin: Point2D): T[] {
    return Transform.rotatePoints(points, -Math.PI / 2, origin);
  },

  /**
   * Rotate points by 180 degrees.
   */
  rotate180<T extends Coordinate>(points: readonly T[], origin: Point2D): T[] {
    return Transform.rotatePoints(points, Math.PI, origin);
  },

  /**
   * Scale uniformly (same factor for X and Y).
   */
  scaleUniform<T extends Coordinate>(points: readonly T[], factor: number, origin: Point2D): T[] {
    return Transform.scalePoints(points, factor, factor, origin);
  },

  /**
   * Flip horizontally (mirror across horizontal axis through origin).
   */
  flipHorizontal<T extends Coordinate>(points: readonly T[], origin: Point2D): T[] {
    return Transform.reflectPoints(points, "horizontal", origin);
  },

  /**
   * Flip vertically (mirror across vertical axis through origin).
   */
  flipVertical<T extends Coordinate>(points: readonly T[], origin: Point2D): T[] {
    return Transform.reflectPoints(points, "vertical", origin);
  },
} as const;
