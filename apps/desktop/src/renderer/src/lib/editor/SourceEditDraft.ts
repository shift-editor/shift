import type { Point2D } from "@shift/geo";
import type { GlyphSource, SourcePositions } from "@/lib/model/Glyph";
import { SourcePositionList, type SourcePositionSubject } from "@/lib/model/SourcePositionList";

export type SourceEditSubject = SourcePositionSubject;

/**
 * Preview-backed source position edit.
 *
 * During interaction, position patches are applied to the local reactive source
 * only. Commit writes the final sparse patch to Rust and records an undoable
 * command without round-tripping the full glyph values buffer.
 */
export class SourceEditDraft {
  readonly glyphSource: GlyphSource;
  readonly subject: SourceEditSubject;

  #base: SourcePositionList;
  #preview: SourcePositionList | null = null;
  #closed = false;

  constructor(glyphSource: GlyphSource, subject: SourceEditSubject) {
    this.glyphSource = glyphSource;

    this.subject = {
      points: subject.points ? [...subject.points] : [],
      anchors: subject.anchors ? [...subject.anchors] : [],
    };
    this.#base = SourcePositionList.fromSubject(glyphSource, this.subject);
  }

  get basePositions(): SourcePositions {
    return this.#base.positions;
  }

  previewPositionPatch(positions: SourcePositions): void {
    if (this.#closed) return;

    this.#base = this.#base.includeFrom(this.glyphSource, positions);
    this.#preview = SourcePositionList.fromPositions(positions);
    this.glyphSource.previewPositionPatch(this.#preview.positions);
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

  preview(positions: SourcePositionList): void {
    this.previewPositionPatch(positions.positions);
  }

  commit(): void {
    if (this.#closed) return;
    this.#closed = true;

    if (!this.#preview || this.#preview.positions.length === 0) return;

    // The movePoints intent from commitPositionPatch IS the ledger entry.
    this.glyphSource.commitPositionPatch(this.#preview.positions);
  }

  discard(): void {
    if (this.#closed) return;
    this.#closed = true;

    if (this.#base.positions.length > 0) {
      this.glyphSource.previewPositionPatch(this.#base.positions);
    }
  }
}
