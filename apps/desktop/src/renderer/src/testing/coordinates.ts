import type { Point2D } from "@shift/types";
import type { Coordinates } from "@/types/coordinates";

/** For tests: build Coordinates with the same point in all three spaces. */
export function makeTestCoordinates(point: Point2D): Coordinates {
  return { screen: { ...point }, scene: { ...point }, glyphLocal: { ...point } };
}
