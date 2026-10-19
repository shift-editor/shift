/**
 * TextLayout — class facade over the segment → position → assemble pipeline.
 *
 * Coordinates: y is negative-down from origin; line N baseline is
 * `origin.y - lineHeight * n`. Cluster is whole-buffer monotonic.
 */
import type { Bounds as BoundsType } from "@shift/geo";
import type { GlyphId } from "@shift/types";
import { Caret } from "./Caret";
import type {
  CaretPosition,
  TextItem,
  SourceMetrics,
  Hit,
  Line,
  Point2D,
  PositionedGlyph,
  SelectionRect,
  PositionedRun,
  TextItemId,
} from "./types";
import { literalRun, shapedRuns, splitParagraphs } from "./paragraphs";
import { Positioner } from "./Positioner";
import type { ShapedRun } from "@shift/types";
import type { Editor } from "../../editor/Editor";
import type { Font } from "../../model/Font";
import type { Signal } from "../../signals/signal";
import type { ExternalAxisLocation } from "../../../types/variation";
import type { TextSelectionRange } from "../../../types/text";

export interface TextLayoutParams {
  items: readonly TextItem[];
  origin: Point2D;
  editor: Editor;
  externalLocation: Signal<ExternalAxisLocation>;
  /**
   * Each paragraph's shaped runs, from shaping these same items and indexed
   * like {@link splitParagraphs}; null lays every paragraph out literally,
   * and a null paragraph lays out literally on its own.
   */
  shaped?: readonly (readonly ShapedRun[] | null)[] | null;
}

/** One positioned glyph with its layout-local placement resolved. */
export interface PlacedGlyph {
  readonly glyph: PositionedGlyph;
  readonly lineIndex: number;
  readonly runIndex: number;
  /** Left edge of the advance box; the caret position before the glyph. */
  readonly left: number;
  /** Baseline of the glyph's line. */
  readonly baseline: number;
  /** Where the glyph's outline is drawn: `left`/`baseline` plus its own offsets. */
  readonly origin: Point2D;
}

interface AssembledLayout {
  lines: Line[];
  totalAdvance: number;
  bounds: BoundsType | null;
}

export class TextLayout {
  readonly metrics: SourceMetrics;
  readonly origin: Point2D;
  readonly lines: readonly Line[];
  readonly totalAdvance: number;
  /** @knipclassignore — bbox union over positioned glyphs; populated when shapeHitTest lands */
  readonly bounds: BoundsType | null;
  readonly bufferLength: number;
  /** Every positioned glyph in line, run, and glyph order. */
  readonly placedGlyphs: readonly PlacedGlyph[];
  readonly #placedByItem: ReadonlyMap<TextItemId, PlacedGlyph>;

  constructor(params: TextLayoutParams) {
    const { items, origin, editor, externalLocation, shaped = null } = params;
    const activeSourceId = editor.activeSourceId;
    this.metrics = activeSourceId
      ? editor.font.metricsForSource(activeSourceId)
      : editor.font.metricsAtLocation(externalLocation.peek());
    this.origin = origin;
    this.bufferLength = items.length;

    const positioner = new Positioner(editor, externalLocation);
    const paragraphs: PositionedParagraph[] = [];
    for (const [index, paragraph] of splitParagraphs(items).entries()) {
      const runs = shaped?.[index];
      paragraphs.push({
        runs: runs
          ? shapedRuns(paragraph, runs).map((run) => positioner.position(run, "anchors"))
          : [positioner.position(literalRun(paragraph, editor.font), "literal")],
        clusterStart: paragraph.clusterStart,
        clusterEnd: paragraph.clusterStart + paragraph.items.length + 1,
      });
    }

    const { lines, totalAdvance, bounds } = assembleLayout(paragraphs, origin, this.metrics);
    this.lines = lines;
    this.totalAdvance = totalAdvance;
    this.bounds = bounds;
    this.placedGlyphs = placeGlyphs(lines, origin);
    const placedByItem = new Map<TextItemId, PlacedGlyph>();
    for (const placed of this.placedGlyphs) {
      for (const itemId of placed.glyph.sourceItemIds) {
        const current = placedByItem.get(itemId);
        // A character the font decomposes (a base and its dot) answers with the glyph that advances.
        if (!current || placed.glyph.xAdvance > current.glyph.xAdvance) {
          placedByItem.set(itemId, placed);
        }
      }
    }
    this.#placedByItem = placedByItem;
  }

  /**
   * Returns the glyph that stands for an item: its widest glyph when shaping
   * split it into several, such as a letter body and a separate dot.
   *
   * @returns null for line breaks and unknown items.
   */
  placedGlyphForItem(itemId: TextItemId): PlacedGlyph | null {
    return this.#placedByItem.get(itemId) ?? null;
  }

  /**
   * Returns one particular glyph an item produced.
   *
   * @returns null when the item produced no such glyph, such as after a reshape replaced it.
   */
  placedGlyph(itemId: TextItemId, glyphId: GlyphId): PlacedGlyph | null {
    return (
      this.placedGlyphs.find(
        (placed) => placed.glyph.glyphId === glyphId && placed.glyph.sourceItemIds.includes(itemId),
      ) ?? null
    );
  }

  /**
   * Hit-test a canvas point against the layout's advance boxes.
   *
   *   1. Find the line whose vertical band [y+descent, y+ascent] contains p.y
   *      (with optional padding for edge tolerance).
   *   2. Walk that line's runs/glyphs, accumulating x from `origin.x`. Return
   *      the glyph whose box [left, left + advance + kern) contains p.x, so a
   *      kerned pair leaves no hole and its first glyph owns any overlap.
   *   3. Within the hit glyph, "left" if p.x is in the left half of the
   *      advance box, "right" otherwise.
   *
   * Returns null when no line / no glyph contains the point.
   */
  hitTest(p: Point2D, padding: number = 0): Hit | null {
    const lineIndex = this.lines.findIndex(
      (line) => p.y <= line.y + line.ascent + padding && p.y >= line.y + line.descent - padding,
    );
    if (lineIndex < 0) return null;

    for (const placed of this.placedGlyphs) {
      if (placed.lineIndex !== lineIndex) continue;
      const width = placed.glyph.xAdvance + placed.glyph.xKern;
      const right = placed.left + width;
      if (p.x < placed.left - padding || p.x >= right + padding) continue;
      const mid = placed.left + width / 2;
      return {
        lineIndex,
        runIndex: placed.runIndex,
        cluster: placed.glyph.cluster,
        side: p.x < mid ? "left" : "right",
      };
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
    const lineHeight = this.metrics.ascender - this.metrics.descender + (this.metrics.lineGap ?? 0);
    const placed = this.placedGlyphs.find((candidate) => candidate.glyph.cluster === cluster);
    return placed ? { x: placed.left, y: placed.baseline, lineHeight } : null;
  }

  /** @knipclassignore — convenience for caret construction at a cluster */
  caretAt(cluster: number): Caret {
    return Caret.atCluster(this, cluster);
  }

  /** @knipclassignore — convenience for caret construction at a canvas point */
  caretAtPoint(p: Point2D): Caret {
    return Caret.atPoint(this, p);
  }

  /** Returns advance-based highlight rectangles for a cluster range, one per line; line breaks own no fill. */
  selectionRects(range: TextSelectionRange): SelectionRect[] {
    const rects: SelectionRect[] = [];
    for (const line of this.lines) {
      let runBase = this.origin.x;
      let left: number | null = null;
      let right = runBase;
      for (const run of line.runs) {
        for (const glyph of run.glyphs) {
          if (glyph.cluster < range.start || glyph.cluster >= range.end) continue;
          left ??= runBase + glyph.origin.x;
          right = runBase + glyph.origin.x + glyph.xAdvance;
        }
        runBase += run.advance;
      }
      if (left !== null) {
        rects.push({
          x: left,
          width: right - left,
          top: line.y + line.ascent,
          bottom: line.y + line.descent,
        });
      }
    }
    return rects;
  }

  measure(): number {
    return this.totalAdvance;
  }
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
  metrics: SourceMetrics,
): AssembledLayout {
  const lineHeight = metrics.ascender - metrics.descender + (metrics.lineGap ?? 0);

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

function placeGlyphs(lines: readonly Line[], origin: Point2D): PlacedGlyph[] {
  const placed: PlacedGlyph[] = [];
  for (const [lineIndex, line] of lines.entries()) {
    let runBase = origin.x;
    for (const [runIndex, run] of line.runs.entries()) {
      for (const glyph of run.glyphs) {
        const left = runBase + glyph.origin.x;
        const baseline = line.y + glyph.origin.y;
        placed.push({
          glyph,
          lineIndex,
          runIndex,
          left,
          baseline,
          origin: { x: left + glyph.xOffset, y: baseline + glyph.yOffset },
        });
      }
      runBase += run.advance;
    }
  }
  return placed;
}
