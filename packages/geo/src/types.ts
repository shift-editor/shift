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
