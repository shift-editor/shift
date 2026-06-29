import type { Point2D } from "@shift/geo";
import type { Canvas } from "@/lib/editor/rendering/Canvas";
import type { CameraTransform } from "@/lib/editor/managers/Camera";
import type { GlyphInstance } from "@/lib/model/Glyph";
import type { Hover } from "@/lib/editor/Hover";
import type { Selection } from "@/lib/editor/Selection";
import { MarkerLayer } from "@/lib/graphics/backends/MarkerLayer";
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

  #markerLayer: MarkerLayer | null = null;

  setMarkerLayer(layer: MarkerLayer | null): void {
    this.#markerLayer = layer;
    this.#markers.resetUpload();
  }

  draw(
    canvas: Canvas,
    camera: CameraTransform,
    drawOffset: Point2D,
    instance: GlyphInstance,
    selection: Selection,
    hover: Hover,
  ): void {
    const list = this.#items.fromContours(instance.render.contours, {
      selection,
      hover,
    });

    if (this.#markers.draw(this.#markerLayer, list, camera, drawOffset)) return;

    this.#canvas.draw(canvas, list.items);
  }

  clear(): void {
    this.#markerLayer?.clear();
    this.#markers.resetUpload();
  }
}
