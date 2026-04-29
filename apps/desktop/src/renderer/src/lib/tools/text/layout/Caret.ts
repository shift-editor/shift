/**
 * Immutable caret over a TextLayout. Every navigation method returns a new
 * instance, so callers hold carets in signals: every keystroke is
 * `$caret.value = $caret.value.next()`.
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

    const direct = layout.pointAt(this.cluster);
    if (direct) return direct;

    for (const line of layout.lines) {
      let cursor = layout.origin.x;
      for (const run of line.runs) {
        for (const g of run.glyphs) {
          if (g.cluster + 1 === this.cluster) {
            return { x: cursor + g.xAdvance, y: line.y, lineHeight };
          }
          cursor += g.xAdvance;
        }
      }
    }

    return { x: layout.origin.x, y: layout.origin.y, lineHeight };
  }

  /** @knipclassignore — vertical nav, deferred to follow-up */
  nextLine(_goalX: number): Caret {
    throw new Error("Caret.nextLine not implemented");
  }

  /** @knipclassignore — vertical nav, deferred to follow-up */
  previousLine(_goalX: number): Caret {
    throw new Error("Caret.previousLine not implemented");
  }

  /**
   * True when the caret sits at a paragraph or buffer boundary.
   * @knipclassignore — used by selection extension logic (TODO)
   */
  isBoundary(): boolean {
    throw new Error("Caret.isBoundary not implemented");
  }
}
