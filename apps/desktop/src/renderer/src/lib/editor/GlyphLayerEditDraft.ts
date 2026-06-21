import type { Point2D } from "@shift/geo";
import type { GlyphLayer, GlyphLayerPositions } from "@/lib/model/Glyph";
import {
  GlyphLayerPositionList,
  type GlyphLayerPositionSubject,
} from "@/lib/model/GlyphLayerPositionList";

export type GlyphLayerEditSubject = GlyphLayerPositionSubject;

/**
 * Preview-backed authored layer position edit.
 *
 * During interaction, position patches are applied to the local reactive layer
 * only. Commit writes the final sparse patch to Rust and records an undoable
 * command without round-tripping the full glyph values buffer.
 */
export class GlyphLayerEditDraft {
  readonly glyphLayer: GlyphLayer;
  readonly subject: GlyphLayerEditSubject;

  #base: GlyphLayerPositionList;
  #preview: GlyphLayerPositionList | null = null;
  #closed = false;

  constructor(glyphLayer: GlyphLayer, subject: GlyphLayerEditSubject) {
    this.glyphLayer = glyphLayer;

    this.subject = {
      points: subject.points ? [...subject.points] : [],
      anchors: subject.anchors ? [...subject.anchors] : [],
    };
    this.#base = GlyphLayerPositionList.fromSubject(glyphLayer, this.subject);
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

    // The movePoints intent from commitPositionPatch IS the ledger entry.
    this.glyphLayer.commitPositionPatch(this.#preview.positions);
  }

  discard(): void {
    if (this.#closed) return;
    this.#closed = true;

    if (this.#base.positions.length > 0) {
      this.glyphLayer.previewPositionPatch(this.#base.positions);
    }
  }
}
