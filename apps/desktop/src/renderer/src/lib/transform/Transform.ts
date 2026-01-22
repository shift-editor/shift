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

import { Mat, type MatModel } from "@/lib/primitives/Mat";
import type { Point2D } from "@shift/types";
import type {
  TransformablePoint,
  ReflectAxis,
  SelectionBounds,
} from "./types";

/**
 * Pure transformation functions for geometry manipulation.
 */
export const Transform = {
  // ============================================
  // Core Transform Operations
  // ============================================

  /**
   * Rotate points around an origin.
   *
   * @param points - Points to transform
   * @param angle - Rotation angle in radians (positive = counter-clockwise)
   * @param origin - Center of rotation
   * @returns New array of transformed points (original unchanged)
   */
  rotatePoints(
    points: readonly TransformablePoint[],
    angle: number,
    origin: Point2D,
  ): TransformablePoint[] {
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
  scalePoints(
    points: readonly TransformablePoint[],
    sx: number,
    sy: number,
    origin: Point2D,
  ): TransformablePoint[] {
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
  reflectPoints(
    points: readonly TransformablePoint[],
    axis: ReflectAxis,
    origin: Point2D,
  ): TransformablePoint[] {
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
  applyMatrix(
    points: readonly TransformablePoint[],
    matrix: MatModel,
    origin: Point2D = { x: 0, y: 0 },
  ): TransformablePoint[] {
    // Build composite: Translate(-origin) → Matrix → Translate(origin)
    // Matrix multiplication order (right to left): fromOrigin × matrix × toOrigin
    const toOrigin = Mat.Translate(-origin.x, -origin.y);
    const fromOrigin = Mat.Translate(origin.x, origin.y);
    const composite = Mat.Compose(Mat.Compose(fromOrigin, matrix), toOrigin);

    return points.map((p) => {
      const transformed = Mat.applyToPoint(composite, { x: p.x, y: p.y });
      return { id: p.id, x: transformed.x, y: transformed.y };
    });
  },

  // ============================================
  // Selection Utilities
  // ============================================

  /**
   * Calculate the bounding box and center of a set of points.
   *
   * @param points - Points to analyze
   * @returns Bounds object with center, extents, and dimensions
   */
  getSelectionBounds(
    points: readonly TransformablePoint[],
  ): SelectionBounds | null {
    if (points.length === 0) {
      return null;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    return {
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  },

  /**
   * Get the center point of a selection's bounding box.
   *
   * @param points - Points to analyze
   * @returns Center point or null if no points
   */
  getSelectionCenter(points: readonly TransformablePoint[]): Point2D | null {
    const bounds = Transform.getSelectionBounds(points);
    return bounds?.center ?? null;
  },

  // ============================================
  // Matrix Builders
  // ============================================

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

  // ============================================
  // Convenience Functions
  // ============================================

  /**
   * Rotate points by 90 degrees counter-clockwise.
   */
  rotate90CCW(
    points: readonly TransformablePoint[],
    origin: Point2D,
  ): TransformablePoint[] {
    return Transform.rotatePoints(points, Math.PI / 2, origin);
  },

  /**
   * Rotate points by 90 degrees clockwise.
   */
  rotate90CW(
    points: readonly TransformablePoint[],
    origin: Point2D,
  ): TransformablePoint[] {
    return Transform.rotatePoints(points, -Math.PI / 2, origin);
  },

  /**
   * Rotate points by 180 degrees.
   */
  rotate180(
    points: readonly TransformablePoint[],
    origin: Point2D,
  ): TransformablePoint[] {
    return Transform.rotatePoints(points, Math.PI, origin);
  },

  /**
   * Scale uniformly (same factor for X and Y).
   */
  scaleUniform(
    points: readonly TransformablePoint[],
    factor: number,
    origin: Point2D,
  ): TransformablePoint[] {
    return Transform.scalePoints(points, factor, factor, origin);
  },

  /**
   * Flip horizontally (mirror across horizontal axis through origin).
   */
  flipHorizontal(
    points: readonly TransformablePoint[],
    origin: Point2D,
  ): TransformablePoint[] {
    return Transform.reflectPoints(points, "horizontal", origin);
  },

  /**
   * Flip vertically (mirror across vertical axis through origin).
   */
  flipVertical(
    points: readonly TransformablePoint[],
    origin: Point2D,
  ): TransformablePoint[] {
    return Transform.reflectPoints(points, "vertical", origin);
  },
} as const;
