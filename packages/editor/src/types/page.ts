import type { Point2D } from "@shift/geo";

/** The camera a page had when it was last shown; session-only. */
export interface PageCamera {
  /** Screen position of the scene origin, in logical pixels. */
  readonly pan: Point2D;
  /** Screen pixels per scene unit. */
  readonly zoom: number;
}
