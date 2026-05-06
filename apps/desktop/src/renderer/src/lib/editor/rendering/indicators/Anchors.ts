import type { AnchorId } from "@shift/types";
import type { Canvas } from "../Canvas";
import type { HandleState } from "@/types/graphics";
import { drawHandle } from "./handleDrawing";
import { Anchor } from "@shift/glyph-state";

/**
 * Draws glyph attachment anchors as diamond handles in UPM space.
 */
export class Anchors {
  draw(
    canvas: Canvas,
    anchors: readonly Anchor[],
    getAnchorState: (anchorId: AnchorId) => HandleState,
  ): void {
    for (const anchor of anchors) {
      drawHandle(canvas, { x: anchor.x, y: anchor.y }, "anchor", getAnchorState(anchor.id));
    }
  }
}
