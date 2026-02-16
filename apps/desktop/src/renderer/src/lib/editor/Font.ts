import type { FontMetrics, FontMetadata } from "@shift/types";
import type { Bounds } from "@shift/geo";

/** Read-only font data surface exposed to tools and UI. */
export interface Font {
  getMetrics(): FontMetrics;
  getMetadata(): FontMetadata;
  getSvgPathByName?(glyphName: string): string | null;
  getSvgPath(unicode: number): string | null;
  /** Horizontal advance width in UPM units. */
  getAdvanceByName?(glyphName: string): number | null;
  getAdvance(unicode: number): number | null;
  /** Tight bounding box in UPM space. */
  getBboxByName?(glyphName: string): Bounds | null;
  getBbox(unicode: number): Bounds | null;
}
