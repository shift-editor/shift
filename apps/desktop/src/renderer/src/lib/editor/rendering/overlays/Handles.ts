import type { Point2D } from "@shift/geo";
import type { Canvas } from "@/lib/editor/rendering/Canvas";
import type { CameraTransform } from "@/lib/editor/managers/Camera";
import type { Editor } from "@/lib/editor/Editor";
import { computed, type ComputedSignal } from "@/lib/signals";
import { MarkerLayer } from "@/lib/graphics/backends/MarkerLayer";
import { HandleDisplayList, HandleItems } from "./handles/HandleItems";
import { MarkerHandleRenderer } from "./handles/MarkerHandleRenderer";
import { CanvasHandleRenderer } from "./handles/CanvasHandleRenderer";

/**
 * Point-handle renderer.
 *
 * Handles owns point-handle item construction and the choice between the
 * accelerated marker layer and the CPU fallback.
 */
export class Handles {
  readonly #editor: Editor;
  readonly #items = new HandleItems();
  readonly #markers = new MarkerHandleRenderer();
  readonly #canvas = new CanvasHandleRenderer();
  readonly #displayList: ComputedSignal<HandleDisplayList>;

  #markerLayer: MarkerLayer | null = null;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#displayList = computed(
      () => {
        const instance = this.#editor.scene.selectedInstanceCell.value;
        const display = this.#editor.glyphDisplayCell.value;

        if (
          !instance ||
          display.proofMode ||
          !display.handlesVisible ||
          !display.editableGlyphVisible
        ) {
          return HandleDisplayList.empty;
        }

        instance.render.trackShape();

        return this.#items.fromContours(instance.render.contours, {
          selection: this.#editor.selection.stateCell.value,
          hover: this.#editor.hover.targetCell.value,
        });
      },
      { name: "handles.displayList" },
    );
  }

  setMarkerLayer(layer: MarkerLayer | null): void {
    this.#markerLayer = layer;
    this.#markers.resetUpload();
  }

  draw(canvas: Canvas, camera: CameraTransform, drawOffset: Point2D): void {
    const list = this.#displayList.peek();

    if (this.#markers.draw(this.#markerLayer, list, camera, drawOffset)) return;

    this.#canvas.draw(canvas, list.items);
  }

  clear(): void {
    this.#markerLayer?.clear();
    this.#markers.resetUpload();
  }
}
