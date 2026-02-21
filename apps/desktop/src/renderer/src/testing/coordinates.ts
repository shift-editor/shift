import type { Point2D } from "@shift/types";
import type { Coordinates } from "@/types/coordinates";

/** For tests: build Coordinates with the same point in all three spaces. */
export function makeTestCoordinates(point: Point2D): Coordinates {
  return { screen: { ...point }, scene: { ...point }, glyphLocal: { ...point } };
}

/**
 * For tests: build Coordinates from scene space with an explicit draw offset.
 * Screen defaults to scene unless a custom screen point is provided.
 */
export function makeTestCoordinatesFromScene(
  scene: Point2D,
  drawOffset: Point2D,
  screen: Point2D = scene,
): Coordinates {
  return {
    screen: { ...screen },
    scene: { ...scene },
    glyphLocal: {
      x: scene.x - drawOffset.x,
      y: scene.y - drawOffset.y,
    },
  };
}

/** For tests: build Coordinates from glyph-local space with an explicit draw offset. */
export function makeTestCoordinatesFromGlyphLocal(
  glyphLocal: Point2D,
  drawOffset: Point2D,
  screen?: Point2D,
): Coordinates {
  const scene = {
    x: glyphLocal.x + drawOffset.x,
    y: glyphLocal.y + drawOffset.y,
  };
  return {
    screen: { ...(screen ?? scene) },
    scene,
    glyphLocal: { ...glyphLocal },
  };
}
