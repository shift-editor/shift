import { deriveGlyphXBounds as deriveFontGlyphXBounds } from "@shift/font";
import type { Glyph } from "@/lib/model/glyph";

export interface GlyphSidebearings {
  readonly lsb: number | null;
  readonly rsb: number | null;
}

export function deriveGlyphXBounds(glyph: Glyph): { minX: number; maxX: number } | null {
  return deriveFontGlyphXBounds(glyph);
}

export function deriveGlyphSidebearings(glyph: Glyph | null): GlyphSidebearings {
  if (!glyph) {
    return { lsb: null, rsb: null };
  }

  const bounds = deriveGlyphXBounds(glyph);
  if (!bounds) {
    return { lsb: null, rsb: null };
  }

  return {
    lsb: bounds.minX,
    rsb: glyph.xAdvance - bounds.maxX,
  };
}

export function roundSidebearing(value: number | null): number | null {
  if (value === null) return null;
  return Math.round(value);
}
