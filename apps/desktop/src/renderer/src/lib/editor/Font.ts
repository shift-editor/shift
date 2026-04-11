import type { FontMetrics, FontMetadata } from "@shift/types";
import type { GlyphView } from "@/engine/FontEngine";

/** Read-only font data surface exposed to tools and UI. */
export interface Font {
  getMetrics(): FontMetrics;
  getMetadata(): FontMetadata;
  /** Get glyph data by name. Cached and self-invalidating. */
  getGlyph(name: string): GlyphView | null;
  /** Get glyph data by unicode codepoint. */
  getGlyphByUnicode(unicode: number): GlyphView | null;
}
