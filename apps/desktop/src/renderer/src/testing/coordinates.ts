import type { Point2D } from "@shift/geo";
import { scenePoint, screenPoint } from "@shift/editor/spaces";
import type { Coordinates } from "@shift/editor/types";

/** For tests: build Coordinates with the same point in both spaces. */
export function makeTestCoordinates(point: Point2D): Coordinates {
  return { screen: screenPoint(point.x, point.y), scene: scenePoint(point.x, point.y) };
}
