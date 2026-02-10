import type { Point2D, PointId } from "@shift/types";

/** A point with a stable identity that can be fed into transform operations. */
export interface TransformablePoint {
  readonly id: PointId;
  readonly x: number;
  readonly y: number;
}

/**
 * Axis or arbitrary angle for reflection transforms.
 * Named axes flip across the horizontal or vertical center line;
 * the `{ angle }` variant reflects across a line at the given angle through the origin.
 */
export type ReflectAxis = "horizontal" | "vertical" | { angle: number };

/** Base options shared by all transform operations. Defaults to the selection center when omitted. */
export interface TransformOptions {
  origin?: Point2D;
}

/** Options for scale transforms. When `uniform` is true, aspect ratio is preserved. */
export interface ScaleOptions extends TransformOptions {
  uniform?: boolean;
}

/** Edge or center axis to align selected points against. */
export type AlignmentType = "left" | "center-h" | "right" | "top" | "center-v" | "bottom";

/** Axis along which to evenly distribute selected points. */
export type DistributeType = "horizontal" | "vertical";
