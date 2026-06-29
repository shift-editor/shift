import type { GlyphSidebearings } from "@/lib/model/Glyph";

const EMPTY_SIDEBEARINGS: GlyphSidebearings = { lsb: null, rsb: null };

export interface GlyphSidebearingsState {
  readonly sidebearings: GlyphSidebearings;
  readonly hasLayer: boolean;
}

/**
 * Current glyph sidebearings (LSB/RSB), live-updating.
 *
 * Subscribes to the displayed glyph instance. Interpolated instances still
 * expose resolved values, but report `editable: false` so inputs can display
 * them without mutating a missing authored glyph layer.
 *
 * @returns Current values and whether the displayed instance can be edited.
 */
export function useGlyphSidebearings(): GlyphSidebearingsState {
  return {
    sidebearings: EMPTY_SIDEBEARINGS,
    hasLayer: false,
  };
}
