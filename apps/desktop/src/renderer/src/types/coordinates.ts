import type { Point2D } from "@shift/geo";

/**
 * A point in the active tool coordinate spaces.
 *
 * `glyphLocal` is the current active glyph-local coordinate used by existing
 * tools. It is not enough to identify a local coordinate for an arbitrary
 * placed scene item; item-local conversion requires an `ItemId`.
 */
export interface Coordinates {
  readonly screen: Point2D;
  readonly scene: Point2D;
  readonly glyphLocal: Point2D;
}
