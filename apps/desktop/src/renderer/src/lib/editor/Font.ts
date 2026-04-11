import type { FontMetrics, FontMetadata } from "@shift/types";
import type { GlyphView } from "@/engine/FontEngine";

/** Read-only font data surface exposed to tools and UI. */
export interface Font {
  getMetrics(): FontMetrics;
  getMetadata(): FontMetadata;
  /** Get the current Path2D for any glyph. Always fresh from Rust. */
  getGlyphPath(name: string): Path2D | null;
  /** Get full glyph data by name. */
  getGlyph(name: string): GlyphView | null;
  /** Get glyph data by unicode codepoint. */
  getGlyphByUnicode(unicode: number): GlyphView | null;
}
