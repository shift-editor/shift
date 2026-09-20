import type { Point2D } from "@shift/geo";

export type ScreenPoint = Point2D;
export type ScenePoint = Point2D;
export type NodePoint = Point2D;

/**
 * A point in the active coordinate spaces.
 *
 */
export interface Coordinates {
  readonly screen: ScreenPoint;
  readonly scene: ScenePoint;
}
