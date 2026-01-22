/**
 * TransformService - Pure geometry transformation functions.
 *
 * All functions are pure (no side effects) and operate on arrays of points.
 * These are the building blocks for transform commands and tools.
 */

import { Vec2 } from "@shift/geo";
import { Mat, type MatModel } from "@/lib/primitives/Mat";
import type { Point2D } from "@/types/math";
import type {
  TransformablePoint,
  TransformedPoint,
  ReflectAxis,
  SelectionBounds,
} from "./types";

/**
 * Pure transformation functions for geometry manipulation.
 */
export const TransformService = {
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
  ): TransformedPoint[] {
    return points.map((p) => {
      const rotated = Vec2.rotateAround({ x: p.x, y: p.y }, origin, angle);
      return { id: p.id, x: rotated.x, y: rotated.y };
    });
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
  ): TransformedPoint[] {
    return points.map((p) => ({
      id: p.id,
      x: origin.x + (p.x - origin.x) * sx,
      y: origin.y + (p.y - origin.y) * sy,
    }));
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
  ): TransformedPoint[] {
    if (axis === "horizontal") {
      // Flip across horizontal axis (X axis) - inverts Y
      return points.map((p) => ({
        id: p.id,
        x: p.x,
        y: origin.y - (p.y - origin.y),
      }));
    }

    if (axis === "vertical") {
      // Flip across vertical axis (Y axis) - inverts X
      return points.map((p) => ({
        id: p.id,
        x: origin.x - (p.x - origin.x),
        y: p.y,
      }));
    }

    // Reflect across axis at arbitrary angle
    const { angle } = axis;
    const cos2a = Math.cos(2 * angle);
    const sin2a = Math.sin(2 * angle);

    return points.map((p) => {
      // Translate to origin
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;

      // Apply reflection matrix: [cos2θ  sin2θ] [x]
      //                         [sin2θ -cos2θ] [y]
      const rx = dx * cos2a + dy * sin2a;
      const ry = dx * sin2a - dy * cos2a;

      return {
        id: p.id,
        x: origin.x + rx,
        y: origin.y + ry,
      };
    });
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
  ): TransformedPoint[] {
    // Build composite: Translate(-origin) → Matrix → Translate(origin)
    const toOrigin = Mat.Translate(-origin.x, -origin.y);
    const fromOrigin = Mat.Translate(origin.x, origin.y);
    const composite = Mat.Compose(Mat.Compose(toOrigin, matrix), fromOrigin);

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
  getSelectionBounds(points: readonly TransformablePoint[]): SelectionBounds | null {
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
    const bounds = TransformService.getSelectionBounds(points);
    return bounds?.center ?? null;
  },

  // ============================================
  // Matrix Builders
  // ============================================

  /**
   * Pre-built transformation matrices for common operations.
   */
  matrices: {
    /**
     * Create a rotation matrix.
     * @param angle - Rotation in radians (positive = counter-clockwise)
     */
    rotate(angle: number): Mat {
      return Mat.Rotate(angle);
    },

    /**
     * Create a scale matrix.
     * @param sx - Scale factor X
     * @param sy - Scale factor Y (defaults to sx for uniform scale)
     */
    scale(sx: number, sy: number = sx): Mat {
      return Mat.Scale(sx, sy);
    },

    /**
     * Create a horizontal reflection matrix (flip across X axis).
     * This inverts Y coordinates.
     */
    reflectHorizontal(): Mat {
      return new Mat(1, 0, 0, -1, 0, 0);
    },

    /**
     * Create a vertical reflection matrix (flip across Y axis).
     * This inverts X coordinates.
     */
    reflectVertical(): Mat {
      return new Mat(-1, 0, 0, 1, 0, 0);
    },

    /**
     * Create a reflection matrix across an axis at the given angle.
     * @param angle - Angle of the reflection axis in radians
     */
    reflectAxis(angle: number): Mat {
      const cos2a = Math.cos(2 * angle);
      const sin2a = Math.sin(2 * angle);
      return new Mat(cos2a, sin2a, sin2a, -cos2a, 0, 0);
    },
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
  ): TransformedPoint[] {
    return TransformService.rotatePoints(points, Math.PI / 2, origin);
  },

  /**
   * Rotate points by 90 degrees clockwise.
   */
  rotate90CW(
    points: readonly TransformablePoint[],
    origin: Point2D,
  ): TransformedPoint[] {
    return TransformService.rotatePoints(points, -Math.PI / 2, origin);
  },

  /**
   * Rotate points by 180 degrees.
   */
  rotate180(
    points: readonly TransformablePoint[],
    origin: Point2D,
  ): TransformedPoint[] {
    return TransformService.rotatePoints(points, Math.PI, origin);
  },

  /**
   * Scale uniformly (same factor for X and Y).
   */
  scaleUniform(
    points: readonly TransformablePoint[],
    factor: number,
    origin: Point2D,
  ): TransformedPoint[] {
    return TransformService.scalePoints(points, factor, factor, origin);
  },

  /**
   * Flip horizontally (mirror across horizontal axis through origin).
   */
  flipHorizontal(
    points: readonly TransformablePoint[],
    origin: Point2D,
  ): TransformedPoint[] {
    return TransformService.reflectPoints(points, "horizontal", origin);
  },

  /**
   * Flip vertically (mirror across vertical axis through origin).
   */
  flipVertical(
    points: readonly TransformablePoint[],
    origin: Point2D,
  ): TransformedPoint[] {
    return TransformService.reflectPoints(points, "vertical", origin);
  },
} as const;
