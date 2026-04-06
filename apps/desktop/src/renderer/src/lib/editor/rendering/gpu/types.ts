import type { Point2D } from "@shift/types";
import type { ViewportTransform } from "../CanvasCoordinator";

export const GPU_HANDLE_INSTANCE_FLOATS = 25;

export type GpuHandleShape = "corner" | "smooth" | "control" | "direction" | "first" | "last";

export type GpuColour = [number, number, number, number];

export interface GpuHandleInstance {
  position: Point2D;
  shape: GpuHandleShape;
  shapeId: number;
  rotation: number;
  size: number;
  lineWidth: number;
  extent: Point2D;
  fillColor: GpuColour;
  strokeColor: GpuColour;
  overlayColor: GpuColour;
  barSize: number;
  barStrokeColor: GpuColour;
}

export interface GpuHandleFrame {
  packedInstances: Float32Array;
  instanceCount: number;
  viewport: ViewportTransform;
  drawOffset: Point2D;
  logicalWidth: number;
  logicalHeight: number;
}
