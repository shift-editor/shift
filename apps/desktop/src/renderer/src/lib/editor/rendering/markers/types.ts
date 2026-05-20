import type { Point2D } from "@shift/geo";
export const MARKER_INSTANCE_FLOATS = 25;

export type MarkerShape = "corner" | "smooth" | "control" | "direction" | "first" | "last";

export type MarkerColour = [number, number, number, number];

export interface MarkerInstance {
  position: Point2D;
  shape: MarkerShape;
  shapeId: number;
  rotation: number;
  size: number;
  lineWidth: number;
  extent: Point2D;
  fillColor: MarkerColour;
  strokeColor: MarkerColour;
  overlayColor: MarkerColour;
  barSize: number;
  barStrokeColor: MarkerColour;
}
