/**
 * TextLayout — class facade over the segment → position → assemble pipeline.
 *
 * Coordinates: y is negative-down from origin; line N baseline is
 * `origin.y - lineHeight * n`. Cluster is whole-buffer monotonic.
 */
import type { Bounds as BoundsType } from "@shift/geo";
import type { ShapedParagraph } from "@shift/types";
import { graphemeBoundaries } from "./segmentation";
import { glyphEdge, LineCarets } from "./LineCarets";
import type {
  CaretPosition,
  TextItem,
  SourceMetrics,
  Direction,
  Line,
  Point2D,
  PositionedGlyph,
  PositionedRun,
  SelectionRect,
  Span,
  TextItemId,
} from "./types";
import { literalRun, shapedRuns, splitParagraphs } from "./paragraphs";
import { Positioner } from "./Positioner";
import type { Editor } from "../../editor/Editor";
import type { Signal } from "../../signals/signal";
import type { ExternalAxisLocation } from "../../../types/variation";
import type { TextSelectionRange } from "../../../types/text";

export interface TextLayoutParams {
  items: readonly TextItem[];
  origin: Point2D;
  editor: Editor;
  externalLocation: Signal<ExternalAxisLocation>;
  /**
   * Each paragraph's shaping, from shaping that paragraph's same items and
   * indexed like {@link splitParagraphs}; a null paragraph, or null for all,
   * lays out literally, glyph by glyph.
   */
  shaped?: readonly (ShapedParagraph | null)[] | null;
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

const NO_PARTS: readonly PlacedGlyph[] = [];

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
  /** Each item's glyphs in logical order; see {@link partsOfItem}. */
  readonly #partsByItem: ReadonlyMap<TextItemId, readonly PlacedGlyph[]>;
  /** Where a caret stands on each line. */
  readonly #carets: readonly LineCarets[];

  constructor(params: TextLayoutParams) {
    const { items, origin, editor, externalLocation, shaped = null } = params;
    // The active source can be one an edit just deleted, until the editor moves off it.
    const activeSourceId = editor.activeSourceId;
    const activeSource = activeSourceId ? editor.font.source(activeSourceId) : null;
    this.metrics = activeSource
      ? editor.font.metricsForSource(activeSource.id)
      : editor.font.metricsAtLocation(externalLocation.peek());
    this.origin = origin;
    this.bufferLength = items.length;

    const positioner = new Positioner(editor, externalLocation);
    const paragraphs: PositionedParagraph[] = splitParagraphs(items).map((paragraph, index) => {
      const shapedParagraph = shaped?.[index] ?? null;
      const runs = shapedParagraph
        ? shapedRuns(paragraph, shapedParagraph.runs).map((run) =>
            positioner.position(run, "anchors"),
          )
        : [positioner.position(literalRun(paragraph, editor.font), "literal")];
      return {
        // Shaping returns a paragraph's runs in screen order, reordered by bidi level.
        runs,
        direction: shapedParagraph?.direction ?? "ltr",
        clusterStart: paragraph.clusterStart,
        clusterEnd: paragraph.clusterStart + paragraph.items.length + 1,
      };
    });

    const { lines, totalAdvance, bounds } = assembleLayout(paragraphs, origin, this.metrics);
    this.lines = lines;
    this.totalAdvance = totalAdvance;
    this.bounds = bounds;
    this.placedGlyphs = placeGlyphs(lines, origin);
    const placedByItem = new Map<TextItemId, PlacedGlyph>();
    const partsByItem = new Map<TextItemId, PlacedGlyph[]>();
    for (const placed of this.placedGlyphs) {
      for (const itemId of placed.glyph.sourceItemIds) {
        const parts = partsByItem.get(itemId);
        if (parts) parts.push(placed);
        else partsByItem.set(itemId, [placed]);
        const current = placedByItem.get(itemId);
        // A character the font decomposes (a base and its dot) answers with the glyph that advances.
        if (!current || placed.glyph.xAdvance > current.glyph.xAdvance) {
          placedByItem.set(itemId, placed);
        }
      }
    }
    this.#placedByItem = placedByItem;
    for (const parts of partsByItem.values()) {
      const first = parts[0]!;
      // A right-to-left run lists its glyphs in screen order, the reverse of logical.
      if (lines[first.lineIndex]!.runs[first.runIndex]!.direction === "rtl") parts.reverse();
    }
    this.#partsByItem = partsByItem;
    const boundaries = graphemeBoundaries(items);
    this.#carets = lines.map(
      (line, index) =>
        new LineCarets(
          line,
          this.placedGlyphs.filter((placed) => placed.lineIndex === index),
          origin,
          boundaries,
        ),
    );
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
   * Returns the glyphs an item shapes to, in logical order: a letter's body
   * before its dot, the first half of a split vowel before the second.
   *
   * @remarks
   * A ligature is a part of each item it joins. Empty for line breaks and
   * unknown items. Indexed when the layout is built, so a lookup does not
   * walk the run.
   */
  partsOfItem(itemId: TextItemId): readonly PlacedGlyph[] {
    return this.#partsByItem.get(itemId) ?? NO_PARTS;
  }

  /** Returns the index of the line holding a caret cluster, or -1 when out of range. */
  lineIndexForCluster(cluster: number): number {
    return this.lines.findIndex(
      (line) => cluster >= line.clusterStart && cluster < line.clusterEnd,
    );
  }

  /** Returns a line's base direction, left to right for a line outside the layout. */
  lineDirection(lineIndex: number): Direction {
    return this.lines[lineIndex]?.direction ?? "ltr";
  }

  /**
   * Returns where a caret at `cluster` draws.
   *
   * @remarks
   * A caret before an item sits on its glyph's leading edge: the left edge in
   * left-to-right text, the right edge in right-to-left text. A caret inside
   * a ligature splits the glyph's advance evenly between its items. Clusters
   * outside the layout draw at its origin.
   */
  caretPosition(cluster: number): CaretPosition {
    const lineHeight = this.metrics.ascender - this.metrics.descender + (this.metrics.lineGap ?? 0);
    const lineIndex = this.lineIndexForCluster(cluster);
    const x = this.#carets[lineIndex]?.positionOf(cluster) ?? null;
    if (x === null) return { x: this.origin.x, y: this.origin.y, lineHeight };
    return { x, y: this.lines[lineIndex]!.y, lineHeight };
  }

  /**
   * Returns the caret cluster nearest a point on one of the layout's lines.
   *
   * @param padding - how far past a line's ascent, descent, and ends still counts.
   * @returns null when the point is off every line.
   */
  caretAtPoint(p: Point2D, padding: number = 0): number | null {
    const lineIndex = this.lines.findIndex(
      (line) => p.y <= line.y + line.ascent + padding && p.y >= line.y + line.descent - padding,
    );
    return this.#carets[lineIndex]?.nearest(p.x, padding)?.cluster ?? null;
  }

  /** Returns the caret cluster on a line whose position is nearest `x`. */
  nearestCaretOnLine(lineIndex: number, x: number): number {
    const stop = this.#carets[lineIndex]?.nearest(x) ?? null;
    return stop?.cluster ?? this.lines[lineIndex]?.clusterStart ?? 0;
  }

  /**
   * Returns the caret cluster one character away on screen, to the left
   * (`-1`) or right (`1`), whatever the text's direction.
   *
   * @param accept - which clusters may be landed on; others are passed over.
   * @returns null at the line's edge in that direction.
   */
  visualStep(
    cluster: number,
    direction: -1 | 1,
    accept: (cluster: number) => boolean = () => true,
  ): number | null {
    return (
      this.#carets[this.lineIndexForCluster(cluster)]?.step(cluster, direction, accept) ?? null
    );
  }

  /**
   * Returns the direction of the text at a caret cluster: the run of the
   * glyph its item shaped into, or the line's direction where no glyph holds it.
   */
  directionAt(cluster: number): Direction {
    const lineIndex = this.lineIndexForCluster(cluster);
    const placed = this.placedGlyphs.find(
      (candidate) =>
        candidate.lineIndex === lineIndex &&
        cluster >= candidate.glyph.cluster &&
        cluster < candidate.glyph.cluster + candidate.glyph.sourceItemIds.length,
    );
    if (!placed) return this.lineDirection(lineIndex);
    return this.lines[lineIndex]!.runs[placed.runIndex]!.direction;
  }

  /** Returns the caret cluster at a line's left (`-1`) or right (`1`) end on screen. */
  lineEdge(lineIndex: number, side: -1 | 1): number | null {
    return this.#carets[lineIndex]?.edge(side) ?? null;
  }

  /**
   * Returns the boxes that highlight a selected cluster range, one per
   * contiguous stretch on screen; a range across a direction change can
   * cover several boxes on one line.
   */
  selectionRects(range: TextSelectionRange): SelectionRect[] {
    const { start, end } = range;
    const rects: SelectionRect[] = [];
    for (const [lineIndex, line] of this.lines.entries()) {
      const spans: Span[] = [];
      for (const placed of this.placedGlyphs) {
        if (placed.lineIndex !== lineIndex || placed.glyph.xAdvance <= 0) continue;
        const first = placed.glyph.cluster;
        const count = placed.glyph.sourceItemIds.length;
        const from = Math.max(first, start);
        const to = Math.min(first + count, end);
        if (from >= to) continue;
        const direction = line.runs[placed.runIndex]!.direction;
        const a = glyphEdge(placed, direction, from - first, count);
        const b = glyphEdge(placed, direction, to - first, count);
        spans.push({ left: Math.min(a, b), right: Math.max(a, b) });
      }
      for (const { left, right } of mergeSpans(spans)) {
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
  direction: Direction;
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
    direction: p.direction,
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

const EPSILON = 1e-6;

/** Orders spans by their left edge. */
function byLeft(a: Span, b: Span): number {
  return a.left - b.left;
}

/** Merges touching or overlapping spans. */
function mergeSpans(spans: readonly Span[]): Span[] {
  const merged: Span[] = [];
  for (const span of spans.toSorted(byLeft)) {
    const last = merged.at(-1);
    if (last && span.left <= last.right + EPSILON) {
      merged[merged.length - 1] = { left: last.left, right: Math.max(last.right, span.right) };
    } else {
      merged.push(span);
    }
  }
  return merged;
}
