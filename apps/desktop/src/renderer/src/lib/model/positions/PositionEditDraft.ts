import type { Point2D } from "@shift/geo";
import type { GlyphLayer, GlyphLayerPositions } from "../Glyph";
import { GlyphLayerPositionList } from "../GlyphLayerPositionList";
import type { PositionTargets } from "@/types/positionEdit";

/** Model-private frozen base and local preview backing for fluent position edits. */
export class PositionEditDraft {
  readonly #layer: GlyphLayer;

  #base: GlyphLayerPositionList;
  #preview: GlyphLayerPositionList | null = null;
  #closed = false;

  constructor(layer: GlyphLayer, targets: PositionTargets) {
    this.#layer = layer;
    this.#base = GlyphLayerPositionList.fromTargetGroups(layer, targets);
  }

  get basePositions(): GlyphLayerPositions {
    return this.#base.positions;
  }

  previewPositionPatch(positions: GlyphLayerPositions): void {
    if (this.#closed) return;

    this.#base = this.#base.includeFrom(this.#layer, positions);
    this.#preview = GlyphLayerPositionList.fromPositions(positions);
    this.#layer.previewPositionPatch(this.#preview.positions);
  }

  previewTranslate(delta: Point2D): void {
    this.previewPositionPatch(this.#base.translate(delta).positions);
  }

  previewRotate(angle: number, origin: Point2D): void {
    this.previewPositionPatch(this.#base.rotate(angle, origin).positions);
  }

  commit(): void {
    if (this.#closed) return;
    this.#closed = true;

    if (!this.#preview || this.#preview.positions.length === 0) return;
    this.#layer.applyPositionPatch(this.#preview.positions);
  }

  discard(): void {
    if (this.#closed) return;
    this.#closed = true;

    if (this.#base.positions.length > 0) {
      this.#layer.previewPositionPatch(this.#base.positions);
    }
  }
}
