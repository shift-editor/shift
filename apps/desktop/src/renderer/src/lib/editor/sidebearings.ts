import { deriveGlyphXBounds as deriveFontGlyphXBounds } from "@shift/font";
import type { Glyph } from "@shift/types";

export interface GlyphSidebearings {
  readonly lsb: number | null;
  readonly rsb: number | null;
}

export function deriveGlyphXBounds(glyph: Glyph): { minX: number; maxX: number } | null {
  return deriveFontGlyphXBounds(glyph);
}

export function deriveGlyphSidebearings(glyph: Glyph): GlyphSidebearings {
  const bounds = deriveGlyphXBounds(glyph);
  if (!bounds) {
    return { lsb: null, rsb: null };
  }

  return {
    lsb: bounds.minX,
    rsb: glyph.xAdvance - bounds.maxX,
  };
}

export function roundSidebearing(value: number): number {
  return Math.round(value);
}
