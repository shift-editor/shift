import type { Point2D } from "@shift/types";

/**
 * A point in all three coordinate spaces: screen (canvas pixels), scene (UPM
 * viewport space), and glyph-local (scene minus drawOffset, origin at glyph
 * left baseline). Built only via Editor.fromScreen / fromScene / fromGlyphLocal.
 */
export interface Coordinates {
  readonly screen: Point2D;
  readonly scene: Point2D;
  readonly glyphLocal: Point2D;
}
