import type { GlyphView } from "@/lib/model/Glyph";
import type { Hover } from "@/lib/editor/Hover";
import type { Selection } from "@/lib/editor/Selection";
import type { GlyphNode } from "@/types/node";
import type { RenderContext } from "@/types/rendering";
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
    view: GlyphView,
    selection: Selection,
    hover: Hover,
  ): void {
    const list = this.#items.fromContours(view.render.contours, {
      selection,
      hover,
    });

    if (this.#markers.draw(ctx.markers, list, ctx.canvas.camera, node.position)) return;

    this.#canvas.draw(ctx.canvas, list.items);
  }
}
