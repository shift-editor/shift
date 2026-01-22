/**
 * Transform System Types
 *
 * Types for geometry transformations (rotate, scale, reflect).
 */

import type { Point2D } from "@/types/math";
import type { PointId } from "@/types/ids";

/**
 * A point that can be transformed.
 * Contains ID for tracking and coordinates for transformation.
 */
export interface TransformablePoint {
  readonly id: PointId;
  readonly x: number;
  readonly y: number;
}

/**
 * Result of a transform operation - same structure as input.
 */
export interface TransformedPoint {
  readonly id: PointId;
  readonly x: number;
  readonly y: number;
}

/**
 * Defines the origin (pivot point) for a transformation.
 */
export type TransformOrigin =
  | { type: "selection-center" }
  | { type: "contour-centers" }
  | { type: "point"; point: Point2D }
  | { type: "bbox-corner"; corner: "tl" | "tr" | "bl" | "br" };

/**
 * Axis for reflection transforms.
 */
export type ReflectAxis =
  | "horizontal" // Flip across X axis (inverts Y coordinates)
  | "vertical" // Flip across Y axis (inverts X coordinates)
  | { angle: number }; // Flip across axis at given angle (radians)

/**
 * Options for transform operations.
 */
export interface TransformOptions {
  /**
   * Origin point for the transform.
   * If not provided, uses the center of the selection's bounding box.
   */
  origin?: Point2D;
}

/**
 * Options for scale transform.
 */
export interface ScaleOptions extends TransformOptions {
  /**
   * If true, constrain to uniform scaling (sy = sx).
   */
  uniform?: boolean;
}

/**
 * Result of computing a selection's bounds.
 */
export interface SelectionBounds {
  readonly center: Point2D;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}
