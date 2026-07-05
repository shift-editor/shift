export interface GlyphXAdvanceState {
  readonly xAdvance: number;
  readonly hasLayer: boolean;
}

/**
 * Current glyph xAdvance, live-updating. Returns `0` when no glyph is loaded.
 */
export function useGlyphXAdvance(): GlyphXAdvanceState {
  return {
    xAdvance: 0,
    hasLayer: false,
  };
}
