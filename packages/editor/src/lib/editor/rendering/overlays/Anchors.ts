import type { Canvas } from "../Canvas";
import type { HandleState } from "../../../../types/graphics";
import { drawHandle } from "./handleDrawing";
import type { HandleStateSource } from "./handles/HandleItems";
import type { Point2D } from "@shift/geo";
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
    canvas.withScreenSpace((screen, project) => {
      for (const anchor of anchors) {
        drawHandle(screen, project.point(anchor), "anchor", this.#anchorState(anchor, state));
      }
    });
  }

  /**
   * Draws anchors a composite takes from its components, dimmed: they follow
   * the components and are edited there.
   */
  drawInherited(canvas: Canvas, anchors: readonly Point2D[]): void {
    canvas.withScreenSpace((screen, project) => {
      for (const anchor of anchors)
        drawHandle(screen, project.point(anchor), "anchor", "interpolated");
    });
  }

  #anchorState(anchor: GlyphRenderAnchor, source: HandleStateSource): HandleState {
    if (source.interpolated) return "interpolated";

    if (source.selection.has(anchor.id)) return "selected";

    if (source.hover.has(anchor.id)) return "hovered";

    return "idle";
  }
}
