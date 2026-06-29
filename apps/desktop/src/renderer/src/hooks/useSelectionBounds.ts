import type { Bounds } from "@shift/geo";

/**
 * Current selection bounds.
 * No-op while selection geometry is being moved from editor-global glyph
 * state to scene/node resolved geometry.
 */
export function useSelectionBounds(): Bounds | null {
  return null;
}
