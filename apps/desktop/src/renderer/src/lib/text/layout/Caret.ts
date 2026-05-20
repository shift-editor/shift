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
    const hit = layout.hitTest(p);
    if (!hit) return new Caret(layout, 0);
    const cluster = hit.side === "left" ? hit.cluster : hit.cluster + 1;
    return Caret.atCluster(layout, cluster);
  }

  next(): Caret {
    return Caret.atCluster(this.layout, this.cluster + 1);
  }

  previous(): Caret {
    return Caret.atCluster(this.layout, this.cluster - 1);
  }

  /**
   * Project the cluster onto canvas coordinates.
   *
   *   1. If the cluster has a positioned glyph (leading edge) → use it.
   *   2. Otherwise (cluster falls on a linebreak or past the last glyph) →
   *      use the trailing edge of the preceding glyph (cluster - 1).
   *   3. If there are no glyphs at all (empty buffer) → origin.
   *
   * Example with buffer [A, \n, B]:
   *
   *   cluster 0  →  pointAt(0) hits A's leading edge          { x: origin.x,        y: 0 }
   *   cluster 1  →  no glyph; trailing edge of A              { x: origin.x + A.adv, y: 0 }
   *   cluster 2  →  pointAt(2) hits B's leading edge          { x: origin.x,        y: -lineHeight }
   *   cluster 3  →  no glyph; trailing edge of B              { x: origin.x + B.adv, y: -lineHeight }
   */
  position(): CaretPosition {
    const layout = this.layout;
    const m = layout.metrics;
    const lineHeight = m.ascender - m.descender + (m.lineGap ?? 0);

    // Direct: cluster has a positioned glyph → its leading edge.
    const direct = layout.pointAt(this.cluster);
    if (direct) return direct;

    // Find which line owns this cluster (uses clusterStart / clusterEnd
    // so empty paragraphs land on their own line, not line 0).
    for (const line of layout.lines) {
      if (this.cluster < line.clusterStart || this.cluster >= line.clusterEnd)
        continue;

      // On this line. Walk to find the trailing edge of the item whose
      // cluster + 1 === this.cluster (i.e. caret sits right after that item).
      let cursor = layout.origin.x;
      for (const run of line.runs) {
        for (const g of run.glyphs) {
          if (g.cluster + 1 === this.cluster) {
            return { x: cursor + g.xAdvance, y: line.y, lineHeight };
          }
          cursor += g.xAdvance;
        }
      }

      // Empty line (no glyphs to walk). Caret sits at line origin.
      return { x: layout.origin.x, y: line.y, lineHeight };
    }

    // Cluster doesn't fall on any line (empty buffer or out of range).
    return { x: layout.origin.x, y: layout.origin.y, lineHeight };
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
      return Caret.atCluster(
        this.layout,
        this.layout.lines[idx].clusterEnd - 1,
      );
    }
    return Caret.atCluster(
      this.layout,
      this.#nearestClusterOnLine(targetIdx, goalX),
    );
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
    return Caret.atCluster(
      this.layout,
      this.#nearestClusterOnLine(targetIdx, goalX),
    );
  }

  #findLineIndex(): number {
    for (const [i, line] of this.layout.lines.entries()) {
      if (this.cluster >= line.clusterStart && this.cluster < line.clusterEnd)
        return i;
    }
    return -1;
  }

  #nearestClusterOnLine(lineIdx: number, goalX: number): number {
    const line = this.layout.lines[lineIdx];

    let bestCluster = line.clusterStart;
    let bestDist = Infinity;
    let cursor = this.layout.origin.x;

    for (const run of line.runs) {
      for (const g of run.glyphs) {
        const leadingDist = Math.abs(cursor - goalX);
        if (leadingDist < bestDist) {
          bestDist = leadingDist;
          bestCluster = g.cluster;
        }
        const trailingX = cursor + g.xAdvance;
        const trailingDist = Math.abs(trailingX - goalX);
        if (trailingDist < bestDist) {
          bestDist = trailingDist;
          bestCluster = g.cluster + 1;
        }
        cursor += g.xAdvance;
      }
    }

    return bestCluster;
  }
}
