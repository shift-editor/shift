import type { Point2D } from "@shift/geo";
import type { GlyphGeometry, GlyphSource, SourcePositions } from "@/lib/model/Glyph";
import { SourcePositionList, type SourcePositionSubject } from "@/lib/model/SourcePositionList";
import { SetSourcePositionsCommand } from "@/lib/commands/primitives/SetSourcePositionsCommand";
import type { CommandHistory } from "@/lib/commands/core/CommandHistory";

export type SourceEditSubject = SourcePositionSubject;

export class SourceEditDraft {
  readonly glyphSource: GlyphSource;
  readonly subject: SourceEditSubject;
  readonly baseGeometry: GlyphGeometry;

  readonly #commandHistory: CommandHistory;
  #base: SourcePositionList;
  #preview: SourcePositionList | null = null;
  #closed = false;

  constructor(
    glyphSource: GlyphSource,
    commandHistory: CommandHistory,
    subject: SourceEditSubject,
  ) {
    this.glyphSource = glyphSource;
    this.baseGeometry = glyphSource.geometry;

    this.subject = {
      points: subject.points ? [...subject.points] : [],
      anchors: subject.anchors ? [...subject.anchors] : [],
    };

    this.#commandHistory = commandHistory;
    this.#base = SourcePositionList.fromSubject(this.baseGeometry, this.subject);
  }

  get basePositions(): SourcePositions {
    return this.#base.positions;
  }

  previewPositions(positions: SourcePositions): void {
    if (this.#closed) return;

    this.#base = this.#base.includeFromGeometry(this.baseGeometry, positions);
    this.#preview = SourcePositionList.fromPositions(positions);
    this.glyphSource.previewPositions(this.#preview.positions);
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
    this.previewPositions(positions.positions);
  }

  commit(label: string): void {
    if (this.#closed) return;
    this.#closed = true;

    if (!this.#preview || this.#preview.positions.length === 0) return;

    this.glyphSource.setPositions(this.#preview.positions);
    this.#commandHistory.record(
      new SetSourcePositionsCommand(label, this.#base.positions, this.#preview.positions),
    );
  }

  discard(): void {
    if (this.#closed) return;
    this.#closed = true;

    if (this.#base.positions.length > 0) {
      this.glyphSource.previewPositions(this.#base.positions);
    }
  }
}
