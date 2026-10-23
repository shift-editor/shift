/**
 * TextLayout — class facade over the segment → position → assemble pipeline.
 *
 * Coordinates: y is negative-down from origin; line N baseline is
 * `origin.y - lineHeight * n`. Cluster is whole-buffer monotonic.
 */
import type { Bounds as BoundsType } from "@shift/geo";
import type { GlyphId, ShapedRun } from "@shift/types";
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
import {
  breakLines,
  breakSegments,
  breakableItems,
  splitWideSegments,
  type BreakSegment,
} from "./lineBreaks";
import { Positioner } from "./Positioner";
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
  /**
   * Width to wrap each paragraph's lines at, in font units; lines break after
   * spaces, a word wider than the width keeps a line of its own. Null or
   * absent: each paragraph is one line.
   */
  wrapWidth?: number | null;
}

/** One paragraph's break segments, for a layout engine that wraps text itself. */
export interface ParagraphSegments {
  readonly segments: readonly BreakSegment[];
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
  /** The width lines wrap at, in font units; null when each paragraph is one line. */
  readonly wrapWidth: number | null;
  readonly #placedByItem: ReadonlyMap<TextItemId, PlacedGlyph>;
  readonly #paragraphs: readonly PositionedParagraph[];
  readonly #spaces: ReadonlySet<TextItemId>;

  constructor(params: TextLayoutParams, positioned?: PositionedText) {
    const { items, origin, editor, externalLocation, shaped = null, wrapWidth = null } = params;
    this.origin = origin;
    this.bufferLength = items.length;
    this.wrapWidth = wrapWidth;

    if (positioned) {
      this.metrics = positioned.metrics;
      this.#paragraphs = positioned.paragraphs;
      this.#spaces = positioned.spaces;
    } else {
      const activeSourceId = editor.activeSourceId;
      this.metrics = activeSourceId
        ? editor.font.metricsForSource(activeSourceId)
        : editor.font.metricsAtLocation(externalLocation.peek());
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
      this.#paragraphs = paragraphs;
      this.#spaces = breakableItems(items);
    }
    this.#params = params;

    const { lines, totalAdvance, bounds } = assembleLayout(
      this.#paragraphs,
      origin,
      this.metrics,
      wrapWidth,
      this.#spaces,
    );
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

  readonly #params: TextLayoutParams;

  /**
   * Returns this text wrapped at `width` font units, or unwrapped for null.
   *
   * @remarks
   * Reuses the positioned glyphs: wrapping only regroups them into lines, so
   * it neither shapes nor reads any glyph again. Returns this layout when the
   * width is unchanged.
   */
  withWrapWidth(width: number | null): TextLayout {
    if (width === this.wrapWidth) return this;

    return new TextLayout(
      { ...this.#params, wrapWidth: width },
      { metrics: this.metrics, paragraphs: this.#paragraphs, spaces: this.#spaces },
    );
  }

  /**
   * Each paragraph's break segments, for a layout engine that chooses the
   * width and breaks lines itself (`shift-layout`'s `BreakSegments`).
   */
  paragraphSegments(): ParagraphSegments[] {
    return this.#paragraphs.map((paragraph) => ({
      segments: breakSegments(paragraphGlyphs(paragraph), this.#spaces),
    }));
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
  readonly runs: PositionedRun[];
  readonly clusterStart: number;
  readonly clusterEnd: number;
}

/** A text's positioned paragraphs, shared by its wrapped copies. */
interface PositionedText {
  readonly metrics: SourceMetrics;
  readonly paragraphs: readonly PositionedParagraph[];
  readonly spaces: ReadonlySet<TextItemId>;
}

function assembleLayout(
  paragraphs: readonly PositionedParagraph[],
  origin: Point2D,
  metrics: SourceMetrics,
  wrapWidth: number | null,
  spaces: ReadonlySet<TextItemId>,
): AssembledLayout {
  const lineHeight = metrics.ascender - metrics.descender + (metrics.lineGap ?? 0);

  const lines: Line[] = [];
  for (const paragraph of paragraphs) {
    for (const line of wrapParagraph(paragraph, wrapWidth, spaces)) {
      lines.push({
        ...line,
        y: origin.y - lineHeight * lines.length,
        ascent: metrics.ascender,
        descent: metrics.descender,
      });
    }
  }

  let totalAdvance = 0;
  for (const line of lines) {
    for (const run of line.runs) {
      totalAdvance += run.advance;
    }
  }

  return { lines, totalAdvance, bounds: null };
}

type WrappedLine = Pick<Line, "runs" | "clusterStart" | "clusterEnd">;

/**
 * Splits a paragraph into soft lines no wider than `width`: after spaces,
 * and inside a word too wide for a line.
 *
 * @remarks
 * A soft line owns the clusters from its first glyph up to the next line's
 * first glyph; the last keeps the paragraph's end, which covers its line
 * break or the caret after the text.
 */
function wrapParagraph(
  paragraph: PositionedParagraph,
  width: number | null,
  spaces: ReadonlySet<TextItemId>,
): WrappedLine[] {
  const whole: WrappedLine = {
    runs: paragraph.runs,
    clusterStart: paragraph.clusterStart,
    clusterEnd: paragraph.clusterEnd,
  };
  if (width === null) return [whole];

  const glyphs = paragraphGlyphs(paragraph);
  const segments = splitWideSegments(breakSegments(glyphs, spaces), glyphs, spaces, width);
  const ranges = breakLines(segments, width);
  if (ranges.length <= 1) return [whole];

  const starts = ranges.map((range) => segments[range.start]!.start);
  return ranges.map((_range, index) => {
    const from = starts[index]!;
    const to = index + 1 < starts.length ? starts[index + 1]! : glyphs.length;
    const next = starts[index + 1];
    return {
      runs: sliceRuns(paragraph.runs, from, to),
      clusterStart: index === 0 ? paragraph.clusterStart : glyphs[from]!.cluster,
      clusterEnd: next === undefined ? paragraph.clusterEnd : glyphs[next]!.cluster,
    };
  });
}

/** A paragraph's glyphs in visual order across its runs. */
function paragraphGlyphs(paragraph: PositionedParagraph): PositionedGlyph[] {
  return paragraph.runs.flatMap((run) => run.glyphs);
}

/**
 * The runs holding glyphs `from` to `to` (indexes across all runs), each
 * re-based so its first glyph starts at zero.
 */
function sliceRuns(runs: readonly PositionedRun[], from: number, to: number): PositionedRun[] {
  const sliced: PositionedRun[] = [];
  let offset = 0;
  for (const run of runs) {
    const start = Math.max(from - offset, 0);
    const end = Math.min(to - offset, run.glyphs.length);
    offset += run.glyphs.length;
    if (start >= end) continue;

    const glyphs = run.glyphs.slice(start, end);
    const base = glyphs[0]!.origin.x;
    const last = glyphs[glyphs.length - 1]!;
    sliced.push({
      ...run,
      glyphs: glyphs.map((glyph) => ({
        ...glyph,
        origin: { ...glyph.origin, x: glyph.origin.x - base },
      })),
      advance: last.origin.x + last.xAdvance + last.xKern - base,
    });
  }
  return sliced;
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
