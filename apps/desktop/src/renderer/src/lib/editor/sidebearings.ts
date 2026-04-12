import { deriveGlyphTightBounds } from "@shift/font";
import type { Glyph } from "@shift/types";

export interface GlyphSidebearings {
  readonly lsb: number | null;
  readonly rsb: number | null;
}

export function deriveGlyphXBounds(glyph: Glyph): { minX: number; maxX: number } | null {
  const bounds = deriveGlyphTightBounds(glyph);
  if (!bounds) return null;
  return { minX: bounds.min.x, maxX: bounds.max.x };
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
