import type { FontMetrics, FontMetadata } from "@shift/types";
import type { Bounds } from "@shift/geo";

/** Read-only font data surface exposed to tools and UI. */
export interface Font {
  getMetrics(): FontMetrics;
  getMetadata(): FontMetadata;
  getSvgPath(unicode: number): string | null;
  /** Horizontal advance width in UPM units. */
  getAdvance(unicode: number): number | null;
  /** Tight bounding box in UPM space. */
  getBbox(unicode: number): Bounds | null;
}
