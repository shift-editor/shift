/**
 * A 2D point or vector with x and y coordinates.
 */
export type Point2D = { x: number; y: number };

/**
 * An axis-aligned bounding box.
 */
export interface BBox {
  min: Point2D;
  max: Point2D;
}

/**
 * A rectangle with position, dimensions, and boundary accessors.
 */
export interface Rect2D {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}
