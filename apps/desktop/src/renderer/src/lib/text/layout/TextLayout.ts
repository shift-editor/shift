/**
 * TextLayout — class facade over the segment → position → assemble pipeline.
 *
 * Coordinates: y is negative-down from origin; line N baseline is
 * `origin.y - lineHeight * n`. Cluster is whole-buffer monotonic.
 */
import type { Bounds as BoundsType } from "@shift/geo";
import { Caret } from "./Caret";
import type {
  CaretPosition,
  TextItem,
  FontMetrics,
  GlyphAnchor,
  GlyphTextItem,
  Hit,
  Line,
  ParagraphSlice,
  Point2D,
  PositionedGlyph,
  PositionedRun,
  SegmentedRun,
  TextItemId,
  TextRunId,
} from "./types";
import type { Positioner } from "./Positioner";
import { Font } from "@/lib/model/Font";
import type { Signal } from "@/lib/signals/signal";
import type { AxisLocation } from "@/types/variation";

export interface TextLayoutParams {
  items: readonly TextItem[];
  origin: Point2D;
  font: Font;
  positioner: Positioner;
  designLocation: Signal<AxisLocation>;
}

interface AssembledLayout {
  lines: Line[];
  totalAdvance: number;
  bounds: BoundsType | null;
}

export class TextLayout {
  readonly metrics: FontMetrics;
  readonly origin: Point2D;
  readonly lines: readonly Line[];
  readonly totalAdvance: number;
  /** @knipclassignore — bbox union over positioned glyphs; populated when shapeHitTest lands */
  readonly bounds: BoundsType | null;
  readonly bufferLength: number;
  readonly #items: readonly TextItem[];

  constructor(params: TextLayoutParams) {
    const { items, origin, font, positioner, designLocation } = params;
    this.#items = items;
    this.metrics = font.metrics;
    this.origin = origin;
    this.bufferLength = items.length;

    // splitParagraphs → segmentRuns → position → assemble
    const paragraphs: PositionedParagraph[] = splitParagraphs(items).map(
      (p) => ({
        runs: segmentRuns(p).map((run) =>
          positioner.position(run, font, designLocation),
        ),
        clusterStart: p.clusterStart,
        clusterEnd: p.clusterStart + p.glyphs.length + 1,
      }),
    );

    const { lines, totalAdvance, bounds } = assembleLayout(
      paragraphs,
      origin,
      this.metrics,
    );
    this.lines = lines;
    this.totalAdvance = totalAdvance;
    this.bounds = bounds;
  }

  /**
   * Hit-test a canvas point against the layout's advance boxes.
   *
   *   1. Find the line whose vertical band [y+descent, y+ascent] contains p.y
   *      (with optional padding for edge tolerance).
   *   2. Walk that line's runs/glyphs, accumulating x from `origin.x`. Return
   *      the glyph whose advance box [left, right) contains p.x.
   *   3. Within the hit glyph, "left" if p.x is in the left half of the
   *      advance box, "right" otherwise.
   *
   * Returns null when no line / no glyph contains the point.
   */
  hitTest(p: Point2D, padding: number = 0): Hit | null {
    for (const [lineIndex, line] of this.lines.entries()) {
      const top = line.y + line.ascent;
      const bottom = line.y + line.descent;
      if (p.y > top + padding || p.y < bottom - padding) continue;

      let runBase = this.origin.x;
      for (const [runIndex, run] of line.runs.entries()) {
        for (const g of run.glyphs) {
          const left = runBase + g.origin.x;
          const right = left + g.xAdvance;
          if (p.x >= left - padding && p.x < right + padding) {
            const mid = left + g.xAdvance / 2;
            return {
              lineIndex,
              runIndex,
              cluster: g.cluster,
              side: p.x < mid ? "left" : "right",
            };
          }
        }
        runBase += run.advance;
      }
      return null;
    }
    return null;
  }

  /** @knipclassignore — precise glyph-shape hit-test, deferred to follow-up */
  shapeHitTest(_p: Point2D, _font: Font): Hit | null {
    throw new Error("TextLayout.shapeHitTest not implemented");
  }

  /**
   * Inverse of hitTest: leading-edge canvas point of a positioned glyph at
   * `cluster`. Returns null if the cluster has no positioned glyph (e.g.
   * cluster falls on a linebreak, or past the buffer end).
   */
  pointAt(cluster: number): CaretPosition | null {
    const lineHeight =
      this.metrics.ascender -
      this.metrics.descender +
      (this.metrics.lineGap ?? 0);
    for (const line of this.lines) {
      let runBase = this.origin.x;
      for (const run of line.runs) {
        for (const g of run.glyphs) {
          if (g.cluster === cluster) {
            return {
              x: runBase + g.origin.x,
              y: line.y + g.origin.y,
              lineHeight,
            };
          }
        }
        runBase += run.advance;
      }
    }
    return null;
  }

  glyphsForItem(itemId: TextItemId): readonly PositionedGlyph[] {
    const glyphs: PositionedGlyph[] = [];
    for (const line of this.lines) {
      for (const run of line.runs) {
        for (const glyph of run.glyphs) {
          if (glyph.sourceItemIds.includes(itemId)) glyphs.push(glyph);
        }
      }
    }
    return glyphs;
  }

  primaryGlyphForItem(itemId: TextItemId): PositionedGlyph | null {
    return this.glyphsForItem(itemId)[0] ?? null;
  }

  /**
   * Resolve stable text-item identity to the current scene-space glyph edit
   * origin.
   *
   *   itemId
   *      │
   *      ▼
   *   PositionedGlyph { origin, xOffset/yOffset }
   *      │
   *      ▼
   *   scene edit origin
   */
  editOriginForItem(itemId: TextItemId): Point2D | null {
    for (const line of this.lines) {
      let runBase = this.origin.x;
      for (const run of line.runs) {
        for (const glyph of run.glyphs) {
          if (glyph.sourceItemIds.includes(itemId)) {
            return {
              x: runBase + glyph.origin.x + glyph.xOffset,
              y: line.y + glyph.origin.y + glyph.yOffset,
            };
          }
        }
        runBase += run.advance;
      }
    }
    return null;
  }

  anchorAtPoint(
    runId: TextRunId,
    p: Point2D,
    padding: number = 0,
  ): GlyphAnchor | null {
    const hit = this.hitTest(p, padding);
    if (!hit) return null;
    const item = this.#items[hit.cluster];
    if (!item || item.kind !== "glyph") return null;
    return { runId, itemId: item.id };
  }

  /** @knipclassignore — convenience for caret construction at a cluster */
  caretAt(cluster: number): Caret {
    return Caret.atCluster(this, cluster);
  }

  /** @knipclassignore — convenience for caret construction at a canvas point */
  caretAtPoint(p: Point2D): Caret {
    return Caret.atPoint(this, p);
  }

  measure(): number {
    return this.totalAdvance;
  }
}

/**
 * Split the flat item buffer into paragraphs on linebreak items.
 *
 * Linebreaks are *separators*, not glyphs — they're excluded from any
 * paragraph's `glyphs` array but they consume a cluster index. The next
 * paragraph's `clusterStart` is `previous.clusterStart + previous.glyphs.length + 1`
 * (the +1 is the linebreak itself).
 *
 *   buffer:  [A, B, \n, C, D]                buffer:  [A, \n, \n, B]
 *   index:    0  1   2  3  4                 index:    0   1   2  3
 *
 *   output:  [{[A,B], cs:0},                 output:  [{[A], cs:0},
 *             {[C,D], cs:3}]                           {[],  cs:2},
 *                                                      {[B], cs:3}]
 *
 *   buffer:  [\n, A]               buffer:  [A, \n]            buffer:  []
 *
 *   output:  [{[],  cs:0},         output:  [{[A], cs:0},      output:  []
 *             {[A], cs:1}]                   {[],  cs:2}]
 */
function splitParagraphs(items: readonly TextItem[]): ParagraphSlice[] {
  const paragraphs: ParagraphSlice[] = [];
  let glyphs: GlyphTextItem[] = [];
  let clusterStart = 0;

  items.forEach((item, index) => {
    if (item.kind === "linebreak") {
      paragraphs.push({ glyphs, clusterStart });
      glyphs = [];
      clusterStart = index + 1;
      return;
    }
    glyphs.push(item);
  });

  if (glyphs.length > 0 || items.length > 0) {
    paragraphs.push({ glyphs, clusterStart });
  }

  return paragraphs;
}

/**
 * Segment a single paragraph into runs by direction / script / language.
 *
 * Phase 1: trivial — every paragraph becomes one LTR run, no BiDi or script
 * detection. Returned as a `SegmentedRun[]` (single-element array) so the
 * shape stays stable when Phase 3 introduces real BiDi.
 *
 *   Phase 1 (today):
 *     paragraph: { glyphs: [A, B, C], cs: 0 }
 *     output:    [{ glyphs: [A,B,C], direction: "ltr", clusterStart: 0 }]
 *
 *   Phase 3 (future, with BiDi):
 *     paragraph: { glyphs: ["h","e","l","l","o"," ","ا","ل","ع","ر","ب","ي","ة"], cs: 0 }
 *     output:    [
 *                  { glyphs: ["h","e","l","l","o"," "], direction: "ltr", cs: 0 },
 *                  { glyphs: ["ا","ل","ع","ر","ب","ي","ة"], direction: "rtl", cs: 6 },
 *                ]
 *
 * Per-paragraph signature (not paragraphs[]) so paragraph structure is
 * preserved through the pipeline — assembleLayout makes one Line per paragraph,
 * each Line's `runs` field holds however many runs that paragraph produced.
 */
function segmentRuns(paragraph: ParagraphSlice): SegmentedRun[] {
  return [
    {
      glyphs: paragraph.glyphs,
      direction: "ltr",
      clusterStart: paragraph.clusterStart,
    },
  ];
}

/**
 * Stack positioned paragraphs into Lines and sum the total advance.
 *
 * One Line per paragraph. Line 0's baseline sits at `origin.y`; line N's at
 * `origin.y - lineHeight * n` (negative-down, matching font convention where
 * ascender > 0 and descender < 0).
 *
 *   origin.y = 0, lineHeight = 1000:
 *
 *     line 0  baseline y = 0       ──────────  [A B]
 *     line 1  baseline y = -1000   ──────────  [C D]
 *     line 2  baseline y = -2000   ──────────  []        ← empty paragraph still gets a line
 *
 * `totalAdvance` is summed from `run.advance` (which Positioner already
 * computed as the sum of its glyphs' xAdvance).
 *
 * `bounds` returns null for now; full bbox union over positioned glyphs is
 * a follow-up. No current test requires it.
 */
interface PositionedParagraph {
  runs: PositionedRun[];
  clusterStart: number;
  clusterEnd: number;
}

function assembleLayout(
  paragraphs: PositionedParagraph[],
  origin: Point2D,
  metrics: FontMetrics,
): AssembledLayout {
  const lineHeight =
    metrics.ascender - metrics.descender + (metrics.lineGap ?? 0);

  const lines: Line[] = paragraphs.map((p, i) => ({
    runs: p.runs,
    y: origin.y - lineHeight * i,
    ascent: metrics.ascender,
    descent: metrics.descender,
    clusterStart: p.clusterStart,
    clusterEnd: p.clusterEnd,
  }));

  let totalAdvance = 0;
  for (const line of lines) {
    for (const run of line.runs) {
      totalAdvance += run.advance;
    }
  }

  return { lines, totalAdvance, bounds: null };
}
