import type { Point2D } from "@shift/geo";
import type { GlyphLayer, GlyphLayerPositions } from "@/lib/model/Glyph";
import { GlyphLayerPositionList } from "@/lib/model/GlyphLayerPositionList";
import type { PositionTargets } from "@/types/positionEdit";

/**
 * Preview-backed authored layer position edit.
 *
 * During interaction, position patches are applied to the local reactive layer
 * only. Commit accepts the final sparse patch as one pending workspace edit;
 * applying its absolute coordinates again is intentionally idempotent.
 */
export class GlyphLayerEditDraft {
  readonly glyphLayer: GlyphLayer;
  readonly targets: PositionTargets;

  #base: GlyphLayerPositionList;
  #preview: GlyphLayerPositionList | null = null;
  #closed = false;

  constructor(glyphLayer: GlyphLayer, targets: PositionTargets) {
    this.glyphLayer = glyphLayer;

    this.targets = {
      points: targets.points ? [...targets.points] : [],
      anchors: targets.anchors ? [...targets.anchors] : [],
    };
    this.#base = GlyphLayerPositionList.fromTargetGroups(glyphLayer, this.targets);
  }

  get basePositions(): GlyphLayerPositions {
    return this.#base.positions;
  }

  previewPositionPatch(positions: GlyphLayerPositions): void {
    if (this.#closed) return;

    this.#base = this.#base.includeFrom(this.glyphLayer, positions);
    this.#preview = GlyphLayerPositionList.fromPositions(positions);
    this.glyphLayer.previewPositionPatch(this.#preview.positions);
  }

  previewTranslate(delta: Point2D): void {
    this.preview(this.#base.translate(delta));
  }

  previewRotate(angle: number, origin: Point2D): void {
    this.preview(this.#base.rotate(angle, origin));
  }

  previewScale(sx: number, sy: number, origin: Point2D): void {
    this.preview(this.#base.scale(sx, sy, origin));
  }

  preview(positions: GlyphLayerPositionList): void {
    this.previewPositionPatch(positions.positions);
  }

  commit(): void {
    if (this.#closed) return;
    this.#closed = true;

    if (!this.#preview || this.#preview.positions.length === 0) return;

    this.glyphLayer.applyPositionPatch(this.#preview.positions);
  }

  discard(): void {
    if (this.#closed) return;
    this.#closed = true;

    if (this.#base.positions.length > 0) {
      this.glyphLayer.previewPositionPatch(this.#base.positions);
    }
  }
}
