import type { AnchorId } from "@shift/types";
import type { Canvas } from "../Canvas";
import type { Glyph } from "@/lib/model/Glyph";
import type { HandleState } from "@/types/graphics";
import { drawHandle } from "./handleDrawing";

/**
 * Draws glyph attachment anchors as diamond handles in UPM space.
 */
export class Anchors {
  draw(
    canvas: Canvas,
    glyph: Glyph,
    getAnchorState: (anchorId: AnchorId) => HandleState,
  ): void {
    for (const anchor of glyph.anchors) {
      drawHandle(canvas, { x: anchor.x, y: anchor.y }, "anchor", getAnchorState(anchor.id));
    }
  }
}
