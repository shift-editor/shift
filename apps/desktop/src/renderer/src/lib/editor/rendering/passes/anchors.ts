import type { Glyph, AnchorId } from "@shift/types";
import type { HandleState } from "@/types/graphics";
import type { DrawAPI } from "@/lib/tools/core/DrawAPI";

/**
 * Draws glyph attachment anchors as diamond handles in UPM space.
 */
export function renderAnchors(
  draw: DrawAPI,
  glyph: Glyph,
  getAnchorState: (anchorId: AnchorId) => HandleState,
): void {
  for (const anchor of glyph.anchors) {
    draw.handle({ x: anchor.x, y: anchor.y }, "anchor", getAnchorState(anchor.id));
  }
}
