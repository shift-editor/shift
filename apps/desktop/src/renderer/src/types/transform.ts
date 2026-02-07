import type { Point2D, PointId } from "@shift/types";

export interface TransformablePoint {
  readonly id: PointId;
  readonly x: number;
  readonly y: number;
}

export type ReflectAxis = "horizontal" | "vertical" | { angle: number };

export interface TransformOptions {
  origin?: Point2D;
}

export interface ScaleOptions extends TransformOptions {
  uniform?: boolean;
}

export type AlignmentType = "left" | "center-h" | "right" | "top" | "center-v" | "bottom";

export type DistributeType = "horizontal" | "vertical";
