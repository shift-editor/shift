/**
 * Transform - matrices about an origin, and their per-frame application to
 * points for rotate and scale drag previews.
 *
 * Committed transforms are shift-font's `TransformPoints` intent: callers build
 * one matrix with {@link Transform.about} and send it; Rust moves the points.
 *
 * @example
 * ```ts
 * import { Transform } from '.';
 *
 * // Preview points rotated 90° around center
 * const rotated = Transform.rotatePoints(points, Math.PI / 2, center);
 * ```
 */

import { Mat, type MatModel, type Point2D } from "@shift/geo";
import type { ReflectAxis } from "./types";

type Coordinate = { readonly x: number; readonly y: number };

/**
 * Pure transformation functions for geometry manipulation.
 */
function reflectionMatrix(axis: ReflectAxis): Mat {
  if (axis === "horizontal") return Mat.ReflectHorizontal();
  if (axis === "vertical") return Mat.ReflectVertical();
  return Mat.ReflectAxis(axis.angle);
}

export const Transform = {
  /** `matrix` applied about `origin` rather than about (0, 0). */
  about(matrix: MatModel, origin: Point2D): MatModel {
    // Matrix multiplication order (right to left): fromOrigin × matrix × toOrigin
    const toOrigin = Mat.Translate(-origin.x, -origin.y);
    const fromOrigin = Mat.Translate(origin.x, origin.y);
    return Mat.Compose(Mat.Compose(fromOrigin, matrix), toOrigin);
  },

  /** The reflection across `axis` through (0, 0). */
  reflectionMatrix,

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
    const composite = Transform.about(matrix, origin);

    return points.map((p) => {
      const transformed = Mat.applyToPoint(composite, p);
      return { ...p, x: transformed.x, y: transformed.y };
    });
  },
} as const;
