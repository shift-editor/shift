/**
 * TextLayout — class facade over the segment → position → assemble pipeline.
 *
 * Coordinates: y is negative-down from origin; line N baseline is
 * `origin.y - lineHeight * n`. Cluster is whole-buffer monotonic.
 */
import type { Bounds as BoundsType } from "@shift/geo";
import { graphemeBoundaries } from "./segmentation";
import type {
  CaretPosition,
  TextItem,
  SourceMetrics,
  Direction,
  GlyphicTextItem,
  Line,
  ParagraphSlice,
  Point2D,
  TextAlign,
  PositionedGlyph,
  PositionedRun,
  SegmentedRun,
  TextItemId,
} from "./types";
import type { Positioner } from "./Positioner";
import { ShapingPositioner } from "./ShapingPositioner";
import type { ShapedParagraph } from "@shift/types";
import type { Editor } from "../../editor/Editor";
import type { Signal } from "../../signals/signal";
import type { ExternalAxisLocation } from "../../../types/variation";

export interface TextLayoutParams {
  items: readonly TextItem[];
  origin: Point2D;
  editor: Editor;
  positioner: Positioner;
  externalLocation: Signal<ExternalAxisLocation>;
  /**
   * Each paragraph's shaping, from shaping that paragraph's same items; a
   * null paragraph, or null for all, lays out literally, glyph by glyph.
   */
  shaped?: readonly (ShapedParagraph | null)[] | null;
  /**
   * How lines line up within the widest one; null or absent follows each
   * line's direction, left for left-to-right and right for right-to-left.
   */
  align?: TextAlign | null;
  /** The distance between baselines in font units; null or absent uses the font's line spacing. */
  lineHeight?: number | null;
}

const shapingPositioner = new ShapingPositioner();

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
  /** Each line's caret stops, in cluster order. */
  readonly #stops: readonly (readonly CaretStop[])[];
  /** Clusters a caret may rest at: grapheme boundaries. */
  readonly #boundaries: ReadonlySet<number>;

  constructor(params: TextLayoutParams) {
    const { items, origin, editor, positioner, externalLocation, shaped = null } = params;
    const align = params.align ?? null;
    // The active source can be one an edit just deleted, until the editor moves off it.
    const activeSourceId = editor.activeSourceId;
    const activeSource = activeSourceId ? editor.font.source(activeSourceId) : null;
    this.metrics = activeSource
      ? editor.font.metricsForSource(activeSource.id)
      : editor.font.metricsAtLocation(externalLocation.peek());
    this.origin = origin;
    this.bufferLength = items.length;

    // splitParagraphs → segmentRuns → position → assemble
    const paragraphs: PositionedParagraph[] = splitParagraphs(items).map((p, index) => ({
      runs: visualOrder(
        segmentRuns(p, shaped?.[index] ?? null).map((run) =>
          run.shaped
            ? shapingPositioner.position(run, run.shaped, editor, externalLocation)
            : positioner.position(run, editor, externalLocation),
        ),
      ),
      direction: shaped?.[index]?.direction ?? "ltr",
      clusterStart: p.clusterStart,
      clusterEnd: p.clusterStart + p.items.length + 1,
    }));

    const { lines, totalAdvance, bounds } = assembleLayout(
      paragraphs,
      origin,
      this.metrics,
      align,
      params.lineHeight ?? null,
    );
    this.lines = lines;
    this.totalAdvance = totalAdvance;
    this.bounds = bounds;
    this.placedGlyphs = placeGlyphs(lines);
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
    this.#boundaries = graphemeBoundaries(items);
    this.#stops = lines.map((line, index) => lineStops(line, index, this.placedGlyphs));
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
   * unknown items.
   */
  partsOfItem(itemId: TextItemId): readonly PlacedGlyph[] {
    const parts = this.placedGlyphs.filter((placed) => placed.glyph.sourceItemIds.includes(itemId));
    const first = parts[0];
    const rightToLeft =
      first && this.lines[first.lineIndex]!.runs[first.runIndex]!.direction === "rtl";
    // A right-to-left run lists its glyphs in screen order, the reverse of logical.
    return rightToLeft ? parts.reverse() : parts;
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
    const stop = this.#stops[lineIndex]?.find((candidate) => candidate.cluster === cluster);
    if (!stop) return { x: this.origin.x, y: this.origin.y, lineHeight };
    return { x: stop.x, y: this.lines[lineIndex]!.y, lineHeight };
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
    const stops = this.#caretStops(lineIndex);
    if (stops.length === 0) return null;
    const xs = stops.map((stop) => stop.x);
    if (p.x < Math.min(...xs) - padding || p.x > Math.max(...xs) + padding) return null;
    return nearest(stops, p.x).cluster;
  }

  /** Returns the caret cluster on a line whose position is nearest `x`. */
  nearestCaretOnLine(lineIndex: number, x: number): number {
    const stops = this.#caretStops(lineIndex);
    return stops.length > 0
      ? nearest(stops, x).cluster
      : (this.lines[lineIndex]?.clusterStart ?? 0);
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
    const lineIndex = this.lineIndexForCluster(cluster);
    const reading = this.lineDirection(lineIndex) === "rtl" ? -1 : 1;
    // Screen order; zero-width glyphs share an x, so ties fall back to reading order.
    const order = [...this.#caretStops(lineIndex)].sort(
      (a, b) => a.x - b.x || (a.cluster - b.cluster) * reading,
    );
    const index = order.findIndex((stop) => stop.cluster === cluster);
    if (index < 0) return null;
    for (let next = index + direction; next >= 0 && next < order.length; next += direction) {
      if (accept(order[next]!.cluster)) return order[next]!.cluster;
    }
    return null;
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
    const stops = this.#caretStops(lineIndex);
    if (stops.length === 0) return null;
    return stops.reduce((edge, stop) => ((stop.x - edge.x) * side > 0 ? stop : edge)).cluster;
  }

  /**
   * Returns the boxes that highlight a selected cluster range, one per
   * contiguous stretch on screen; a range across a direction change can
   * cover several boxes on one line.
   */
  selectionRects(start: number, end: number): SelectionRect[] {
    const rects: SelectionRect[] = [];
    for (const [lineIndex, line] of this.lines.entries()) {
      const spans: [number, number][] = [];
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
        spans.push([Math.min(a, b), Math.max(a, b)]);
      }
      for (const [left, right] of mergeSpans(spans)) {
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

  /** The line's stops a caret may rest at. */
  #caretStops(lineIndex: number): readonly CaretStop[] {
    return (this.#stops[lineIndex] ?? []).filter((stop) => this.#boundaries.has(stop.cluster));
  }

  measure(): number {
    return this.totalAdvance;
  }
}

/**
 * Split the flat item buffer into paragraphs on linebreak items.
 *
 * Linebreaks are *separators*, not glyphs — they're excluded from any
 * paragraph's `items` array but they consume a cluster index. The next
 * paragraph's `clusterStart` is `previous.clusterStart + previous.items.length + 1`
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
  let paragraph: GlyphicTextItem[] = [];
  let clusterStart = 0;

  items.forEach((item, index) => {
    if (item.kind === "linebreak") {
      paragraphs.push({ items: paragraph, clusterStart });
      paragraph = [];
      clusterStart = index + 1;
      return;
    }
    paragraph.push(item);
  });

  if (paragraph.length > 0 || items.length > 0) {
    paragraphs.push({ items: paragraph, clusterStart });
  }

  return paragraphs;
}

/**
 * Segment a single paragraph into runs by direction / script / language.
 *
 * A shaped paragraph takes the shaper's runs: one per script, in logical
 * order, each carrying its glyphs with clusters made run-relative. Without
 * shaping, the paragraph is one literal LTR run.
 *
 *   paragraph: { items: ["h","i"," ","ب","ا"], cs: 0 }, shaped
 *   output:    [
 *                { items: ["h","i"," "], direction: "ltr", cs: 0, shaped: [...] },
 *                { items: ["ب","ا"],     direction: "rtl", cs: 3, shaped: [...] },
 *              ]
 *
 * Runs come out in logical order; {@link visualOrder} puts a line's into
 * screen order.
 * Per-paragraph signature (not paragraphs[]) so paragraph structure is
 * preserved through the pipeline — assembleLayout makes one Line per paragraph,
 * each Line's `runs` field holds however many runs that paragraph produced.
 */
function segmentRuns(paragraph: ParagraphSlice, shaped: ShapedParagraph | null): SegmentedRun[] {
  if (shaped) {
    return shaped.runs.map((run) => ({
      items: paragraph.items.slice(run.start, run.end),
      level: run.level,
      direction: run.direction,
      script: run.script,
      clusterStart: paragraph.clusterStart + run.start,
      shaped: run.glyphs.map((glyph) => ({ ...glyph, cluster: glyph.cluster - run.start })),
    }));
  }
  return [
    {
      items: paragraph.items,
      level: 0,
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
 * Lines line up within the widest line: a left-aligned line starts at
 * `origin.x`, a right-aligned one ends at `origin.x` plus the widest line's
 * advance, and a centred one sits midway. Without an alignment each line
 * follows its direction, so Arabic lines sit right.
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
  align: TextAlign | null,
  chosenLineHeight: number | null,
): AssembledLayout {
  const lineHeight =
    chosenLineHeight ?? metrics.ascender - metrics.descender + (metrics.lineGap ?? 0);
  const advances = paragraphs.map((p) => p.runs.reduce((sum, run) => sum + run.advance, 0));
  const widest = Math.max(0, ...advances);

  const lines: Line[] = paragraphs.map((p, i) => ({
    runs: p.runs,
    direction: p.direction,
    x: origin.x + alignOffset(align ?? directionAlign(p.direction), widest - advances[i]!),
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

function directionAlign(direction: Direction): TextAlign {
  return direction === "rtl" ? "right" : "left";
}

/** How far a line moves right to align it, given the room the widest line leaves it. */
function alignOffset(align: TextAlign, room: number): number {
  switch (align) {
    case "left":
      return 0;
    case "center":
      return room / 2;
    case "right":
      return room;
  }
}

function placeGlyphs(lines: readonly Line[]): PlacedGlyph[] {
  const placed: PlacedGlyph[] = [];
  for (const [lineIndex, line] of lines.entries()) {
    let runBase = line.x;
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

/** A place on a line where a caret can stand, and where it draws. */
interface CaretStop {
  readonly cluster: number;
  readonly x: number;
}

/** A selection highlight box in layout units. */
export interface SelectionRect {
  readonly x: number;
  readonly width: number;
  readonly top: number;
  readonly bottom: number;
}

const EPSILON = 1e-6;

/**
 * Returns a caret stop for every cluster on a line.
 *
 * Each glyph with an advance gives its items stops across its box: the
 * first item at the leading edge, a ligature's later items at even splits,
 * and the cluster after its last item at the trailing edge. A glyph's leading
 * edge wins over its neighbour's trailing edge. Clusters held only by
 * zero-advance glyphs (an unattached mark) stand at the glyph; anything left,
 * such as an empty line's end, stands at the line's end.
 */
function lineStops(
  line: Line,
  lineIndex: number,
  placedGlyphs: readonly PlacedGlyph[],
): CaretStop[] {
  const xs = new Map<number, number>();
  const set = (cluster: number, x: number) => {
    if (!xs.has(cluster)) xs.set(cluster, x);
  };
  const onLine = placedGlyphs.filter((placed) => placed.lineIndex === lineIndex);
  const spacing = onLine.filter((placed) => placed.glyph.xAdvance > 0);
  const direction = (placed: PlacedGlyph) => line.runs[placed.runIndex]!.direction;

  for (const placed of spacing) {
    const count = placed.glyph.sourceItemIds.length;
    for (let k = 0; k < count; k++) {
      set(placed.glyph.cluster + k, glyphEdge(placed, direction(placed), k, count));
    }
  }
  for (const placed of spacing) {
    const count = placed.glyph.sourceItemIds.length;
    set(placed.glyph.cluster + count, glyphEdge(placed, direction(placed), count, count));
  }
  for (const placed of onLine) set(placed.glyph.cluster, placed.left);

  const advance = line.runs.reduce((sum, run) => sum + run.advance, 0);
  const lineEnd = line.direction === "rtl" ? line.x : line.x + advance;
  const stops: CaretStop[] = [];
  for (let cluster = line.clusterStart; cluster < line.clusterEnd; cluster++) {
    stops.push({ cluster, x: xs.get(cluster) ?? lineEnd });
  }
  return stops;
}

/**
 * Returns the x of the boundary `k` items into a glyph covering `count`
 * items, measured from its leading edge. Kerning after the glyph belongs to
 * its box, so a kerned pair leaves no gap between stops.
 */
function glyphEdge(placed: PlacedGlyph, direction: Direction, k: number, count: number): number {
  const width = placed.glyph.xAdvance + placed.glyph.xKern;
  const offset = (width * k) / count;
  return direction === "rtl" ? placed.left + width - offset : placed.left + offset;
}

function nearest(stops: readonly CaretStop[], x: number): CaretStop {
  return stops.reduce((best, stop) => (Math.abs(stop.x - x) < Math.abs(best.x - x) ? stop : best));
}

/** Merges touching or overlapping spans. */
function mergeSpans(spans: [number, number][]): [number, number][] {
  const merged: [number, number][] = [];
  for (const span of spans.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1] + EPSILON) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  return merged;
}

/**
 * Puts a line's runs into screen order by their bidi levels (UAX #9 rule
 * L2): from the highest level down to the lowest odd one, every stretch of
 * runs at that level or above is reversed.
 *
 *   logical:  [من 1] [hello 2] [دوست 1]   (an Arabic paragraph)
 *   level 2:  reverse [hello]              → unchanged
 *   level 1:  reverse all three            → [دوست] [hello] [من]
 */
function visualOrder(runs: PositionedRun[]): PositionedRun[] {
  if (runs.length < 2) return runs;
  const ordered = [...runs];
  const levels = runs.map((run) => run.level);
  const highest = Math.max(...levels);
  const lowestOdd = Math.min(...levels.filter((level) => level % 2 === 1));
  for (let level = highest; level >= lowestOdd; level--) {
    for (let start = 0; start < ordered.length; ) {
      if (ordered[start]!.level < level) {
        start++;
        continue;
      }
      let end = start;
      while (end < ordered.length && ordered[end]!.level >= level) end++;
      ordered.splice(start, end - start, ...ordered.slice(start, end).reverse());
      start = end;
    }
  }
  return ordered;
}
