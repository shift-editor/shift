import type { Canvas } from "../Canvas";
import type { HandleState } from "@/types/graphics";
import { drawHandle } from "./handleDrawing";
import type { HandleStateSource } from "./handles/HandleItems";
import type { GlyphRenderAnchor } from "@/lib/model/GlyphRenderModel";

/**
 * Draws glyph attachment anchors as diamond handles in UPM space.
 */
export class Anchors {
  draw(canvas: Canvas, anchors: readonly GlyphRenderAnchor[], state: HandleStateSource): void {
    for (const anchor of anchors) {
      drawHandle(canvas, { x: anchor.x, y: anchor.y }, "anchor", this.#anchorState(anchor, state));
    }
  }

  #anchorState(anchor: GlyphRenderAnchor, source: HandleStateSource): HandleState {
    if (source.selection.anchorIds.has(anchor.id)) return "selected";

    if (source.hover?.type === "anchor" && source.hover.anchorId === anchor.id) return "hovered";

    return "idle";
  }
}
