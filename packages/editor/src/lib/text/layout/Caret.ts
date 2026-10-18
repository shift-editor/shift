/**
 * Immutable caret over a TextLayout. Every navigation method returns a new
 * instance, so callers hold carets in signals: every keystroke is
 * `caretCell.value = caretCell.value.next()`.
 *
 * `cluster` is whole-buffer (matches HarfBuzz's monotonic guarantee). Valid
 * clusters are [0, layout.bufferLength]; `next()` and `previous()` clamp.
 */
import type { CaretPosition, Point2D } from "./types";
import type { TextLayout } from "./TextLayout";

export class Caret {
  readonly cluster: number;
  readonly layout: TextLayout;

  private constructor(layout: TextLayout, cluster: number) {
    this.layout = layout;
    this.cluster = cluster;
  }

  static atCluster(layout: TextLayout, cluster: number): Caret {
    const clamped = Math.max(0, Math.min(cluster, layout.bufferLength));
    return new Caret(layout, clamped);
  }

  static atPoint(layout: TextLayout, p: Point2D): Caret {
    return Caret.atCluster(layout, layout.caretAtPoint(p) ?? 0);
  }

  next(): Caret {
    return Caret.atCluster(this.layout, this.cluster + 1);
  }

  previous(): Caret {
    return Caret.atCluster(this.layout, this.cluster - 1);
  }

  /** Where the caret draws; see {@link TextLayout.caretPosition}. */
  position(): CaretPosition {
    return this.layout.caretPosition(this.cluster);
  }

  /**
   * Vertical nav: caret on the next line, choosing the cluster whose canvas
   * x is closest to `goalX`. Threading goalX through consecutive Up/Down
   * presses preserves horizontal position across short lines.
   *
   * If already on the last line: clamps to end-of-current-line (VSCode-style).
   */
  nextLine(goalX: number): Caret {
    const idx = this.#findLineIndex();
    if (idx < 0) return this;
    const targetIdx = idx + 1;
    if (targetIdx >= this.layout.lines.length) {
      return Caret.atCluster(this.layout, this.layout.lines[idx].clusterEnd - 1);
    }
    return Caret.atCluster(this.layout, this.#nearestClusterOnLine(targetIdx, goalX));
  }

  /**
   * Vertical nav: caret on the previous line. If already on the first line:
   * clamps to start-of-current-line.
   */
  previousLine(goalX: number): Caret {
    const idx = this.#findLineIndex();
    if (idx < 0) return this;
    const targetIdx = idx - 1;
    if (targetIdx < 0) {
      return Caret.atCluster(this.layout, this.layout.lines[idx].clusterStart);
    }
    return Caret.atCluster(this.layout, this.#nearestClusterOnLine(targetIdx, goalX));
  }

  #findLineIndex(): number {
    return this.layout.lineIndexForCluster(this.cluster);
  }

  #nearestClusterOnLine(lineIdx: number, goalX: number): number {
    return this.layout.nearestCaretOnLine(lineIdx, goalX);
  }
}
