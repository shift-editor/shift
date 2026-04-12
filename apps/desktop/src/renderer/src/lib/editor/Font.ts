import type { FontMetrics, FontMetadata } from "@shift/types";
import type { Bounds } from "@shift/geo";

/** Read-only font data surface exposed to tools and UI. */
export interface Font {
  getMetrics(): FontMetrics;
  getMetadata(): FontMetadata;
  getPath(name: string): Path2D | null;
  nameForUnicode(unicode: number): string | null;
  getAdvance(name: string): number | null;
  getBbox(name: string): Bounds | null;
  getSvgPath(name: string): string | null;
}
