import type { GlyphId } from "@shift/types";

/** A member's word before layout: its width in CSS pixels. */
export interface PreviewWord {
  readonly memberId: GlyphId;
  readonly width: number;
}

/** A word placed in the preview, in CSS pixels. */
export interface PreviewCell<W extends PreviewWord> {
  readonly word: W;
  /** The word's cell: one column of an even grid, so pairs line up in columns. */
  readonly cellX: number;
  readonly cellWidth: number;
  readonly line: number;
  /** Where the word starts, centring it in its cell. */
  readonly x: number;
}

/**
 * The group preview's words wrapped into even columns as wide as the widest
 * word plus a gap, spread to fill the width, one line per row.
 */
export class PreviewLayout<W extends PreviewWord> {
  readonly cells: readonly PreviewCell<W>[];
  readonly lineHeight: number;
  /** The rows' total height, at least one line. */
  readonly height: number;

  private constructor(cells: readonly PreviewCell<W>[], lineHeight: number, lines: number) {
    this.cells = cells;
    this.lineHeight = lineHeight;
    this.height = Math.max(1, lines) * lineHeight;
  }

  static of<W extends PreviewWord>(
    words: readonly W[],
    width: number,
    gap: number,
    lineHeight: number,
  ): PreviewLayout<W> {
    const widest = Math.max(0, ...words.map((word) => word.width));
    const columns = Math.max(1, Math.floor(width / (widest + gap)));
    const cellWidth = width / columns;
    const cells = words.map((word, index) => {
      const cellX = (index % columns) * cellWidth;
      return {
        word,
        cellX,
        cellWidth,
        line: Math.floor(index / columns),
        x: cellX + (cellWidth - word.width) / 2,
      };
    });
    return new PreviewLayout(cells, lineHeight, Math.ceil(words.length / columns));
  }

  /** The member whose cell contains the point, or null over empty space. */
  memberAt(x: number, y: number): GlyphId | null {
    const line = Math.floor(y / this.lineHeight);
    const cell = this.cells.find(
      (candidate) =>
        candidate.line === line &&
        x >= candidate.cellX &&
        x < candidate.cellX + candidate.cellWidth,
    );
    return cell?.word.memberId ?? null;
  }
}
