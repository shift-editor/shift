import type { PointId, ContourId } from "@shift/types";
import type { GlyphContour } from "../../../model/ComponentGlyph";
import type { Hover } from "../../Hover";
import type { Selection } from "../../Selection";
import type { HandleState } from "../../../../types/graphics";
import type { GlyphNode } from "../../../../types/node";
import type { RenderContext } from "../../../../types/rendering";
import { HandleItems } from "./handles/HandleItems";
import { MarkerHandleRenderer } from "./handles/MarkerHandleRenderer";
import { CanvasHandleRenderer } from "./handles/CanvasHandleRenderer";

/**
 * Point-handle renderer.
 *
 * Handles owns point-handle item construction and the choice between the
 * accelerated marker layer and the CPU fallback.
 */
export class Handles {
  readonly #items = new HandleItems();
  readonly #markers = new MarkerHandleRenderer();
  readonly #canvas = new CanvasHandleRenderer();

  draw(
    ctx: RenderContext,
    node: GlyphNode,
    contours: readonly GlyphContour[],
    selection: Selection,
    hover: Hover,
    interpolated: boolean,
    isVisible?: (pointId: PointId, contourId: ContourId) => boolean,
  ): void {
    const list = this.#items.fromContours(
      contours.map((contour) => contour.contour),
      {
        selection,
        hover,
        interpolated,
      },
      isVisible,
    );

    if (this.#markers.draw(ctx.markers, list, ctx.canvas.camera, node.position, ctx.canvas.theme))
      return;

    this.#canvas.draw(ctx.canvas, list.items);
  }

  /**
   * Returns the state of every handle {@link draw} would render for the same inputs.
   *
   * @returns Handle state keyed by point, in drawing order.
   */
  states(
    contours: readonly GlyphContour[],
    selection: Selection,
    hover: Hover,
    interpolated: boolean,
    isVisible?: (pointId: PointId, contourId: ContourId) => boolean,
  ): ReadonlyMap<PointId, HandleState> {
    const list = new HandleItems().fromContours(
      contours.map((contour) => contour.contour),
      { selection, hover, interpolated },
      isVisible,
    );
    return new Map(list.items.map((item) => [item.point.id, item.state]));
  }
}
