import { Mat } from "@shift/geo";
import type { Canvas } from "../Canvas";
import type { HandleState } from "../../../../types/graphics";
import { drawHandle } from "./handleDrawing";
import type { HandleStateSource } from "./handles/HandleItems";
import type { GlyphRenderAnchor } from "../../../../types/glyphRender";

/**
 * Draws glyph attachment anchors as screen-sized diamond handles.
 */
export class Anchors {
  /**
   * Draws each anchor at its projected position.
   *
   * @param canvas - Canvas in the units the anchors are measured in.
   */
  draw(canvas: Canvas, anchors: readonly GlyphRenderAnchor[], state: HandleStateSource): void {
    // Captured before entering screen space, where the canvas transform becomes identity.
    const toScreen = Mat.Copy(canvas.transform);

    canvas.withScreenSpace(() => {
      for (const anchor of anchors) {
        const point = Mat.applyToPoint(toScreen, anchor);
        drawHandle(canvas, point, "anchor", this.#anchorState(anchor, state));
      }
    });
  }

  #anchorState(anchor: GlyphRenderAnchor, source: HandleStateSource): HandleState {
    if (source.interpolated) return "interpolated";

    if (source.selection.has(anchor.id)) return "selected";

    if (source.hover.has(anchor.id)) return "hovered";

    return "idle";
  }
}
