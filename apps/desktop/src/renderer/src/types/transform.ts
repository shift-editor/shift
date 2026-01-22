import type { Point2D, PointId } from "@shift/types";

export interface TransformablePoint {
  readonly id: PointId;
  readonly x: number;
  readonly y: number;
}

export type ReflectAxis =
  | "horizontal"
  | "vertical"
  | { angle: number };

export interface TransformOptions {
  origin?: Point2D;
}

export interface ScaleOptions extends TransformOptions {
  uniform?: boolean;
}

export interface SelectionBounds {
  readonly center: Point2D;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}
