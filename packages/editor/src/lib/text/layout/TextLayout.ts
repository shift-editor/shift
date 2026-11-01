/**
 * TextLayout — a run's text as Rust laid it out (`shift_layout::TextLayout`
 * through the window's engine), indexed for drawing, hit testing, carets and
 * selection. It applies no layout rule: lines, glyph positions, kerning,
 * marks, cursive joins, bidi order and caret stops all come from Rust.
 *
 * Coordinates: y is negative-down from origin; line N baseline is
 * `origin.y - lineHeight * n`. Cluster is whole-buffer monotonic.
 */
import type { Bounds as BoundsType } from "@shift/geo";
import { EntityMap, type GlyphId, type GlyphName, type ReadonlyEntityMap } from "@shift/types";
import type { CaretStop, TextLayout as LaidOutText } from "@shift/wasm/protocol";
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
import type { Font } from "../../model/Font";
import type { TextSelectionRange } from "../../../types/text";

export interface TextLayoutParams {
  items: readonly TextItem[];
  origin: Point2D;
  font: Font;
  metrics: SourceMetrics;
  /** The run's text as Rust laid it out. */
  laidOut: LaidOutText;
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

const NOTDEF = ".notdef" as GlyphName;

export class TextLayout {
  readonly metrics: SourceMetrics;
  readonly origin: Point2D;
  readonly lines: readonly Line[];
  readonly totalAdvance: number;
  /** @knipclassignore — bbox union over positioned glyphs; populated when shapeHitTest lands */
  readonly bounds: BoundsType | null = null;
  readonly bufferLength: number;
  /** Every positioned glyph in line, run, and glyph order. */
  readonly placedGlyphs: readonly PlacedGlyph[];
  /** Why some of the text was laid out as typed rather than shaped, when it was. */
  readonly unshaped: string | null;
  readonly #placedByItem: ReadonlyEntityMap<TextItemId, PlacedGlyph>;
  readonly #carets: readonly CaretStop[];

  constructor(params: TextLayoutParams) {
    const { items, origin, font, metrics, laidOut } = params;
    this.metrics = metrics;
    this.origin = origin;
    this.bufferLength = items.length;
    this.unshaped = laidOut.unshaped ?? null;
    this.#carets = laidOut.carets;

    const placed: PlacedGlyph[] = [];
    const lines: Line[] = [];
    for (const [lineIndex, line] of laidOut.lines.entries()) {
      const nextStart = laidOut.lines[lineIndex + 1]?.start ?? null;
      const runs: PositionedRun[] = [];
      for (const [runIndex, run] of line.runs.entries()) {
        const glyphs = laidOut.glyphs.slice(run.glyphStart, run.glyphEnd);
        const runLeft = glyphs[0]?.left ?? line.left;
        const positioned = glyphs.map(
          (glyph): PositionedGlyph => ({
            glyphId: glyph.glyphId ?? null,
            glyphName: glyphName(font, items, glyph.glyphId ?? null, glyph.start),
            sourceItemIds: items.slice(glyph.start, glyph.end).map((item) => item.id),
            origin: { x: glyph.left - runLeft, y: 0 },
            xAdvance: glyph.advance,
            xKern: glyph.kern,
            yAdvance: 0,
            xOffset: glyph.xOffset,
            yOffset: glyph.yOffset,
            cluster: glyph.start,
          }),
        );
        for (const [index, glyph] of glyphs.entries()) {
          const left = origin.x + glyph.left;
          const baseline = origin.y + glyph.baseline;
          placed.push({
            glyph: positioned[index]!,
            lineIndex,
            runIndex,
            left,
            baseline,
            origin: { x: left + glyph.xOffset, y: baseline + glyph.yOffset },
          });
        }
        runs.push({
          glyphs: positioned,
          direction: run.direction,
          script: run.script,
          advance: glyphs.reduce((sum, glyph) => sum + glyph.advance + glyph.kern, 0),
        });
      }
      // A line ends where the next starts (after its line break, if any); the
      // last line also holds the caret after its end.
      const clusterEnd = nextStart === null ? line.end + 1 : line.end;
      lines.push({
        runs,
        y: origin.y + line.baseline,
        ascent: line.ascent,
        descent: line.descent,
        clusterStart: line.start,
        clusterEnd,
      });
    }
    this.lines = lines;
    this.placedGlyphs = placed;
    this.totalAdvance = laidOut.lines.reduce((sum, line) => sum + line.advance, 0);

    const placedByItem = new EntityMap<TextItemId, PlacedGlyph>("placed glyph");
    for (const glyph of placed) {
      for (const itemId of glyph.glyph.sourceItemIds) {
        const current = placedByItem.get(itemId);
        // A character the font decomposes (a base and its dot) answers with the glyph that advances.
        if (!current || glyph.glyph.xAdvance > current.glyph.xAdvance) {
          placedByItem.set(itemId, glyph);
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
    return this.#placedByItem.get(itemId);
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
   *   2. Return the glyph on that line whose box [left, left + advance + kern)
   *      contains p.x, so a kerned pair leaves no hole and its first glyph
   *      owns any overlap.
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
   * Where the caret goes before `cluster`, from the caret stops Rust placed:
   * the leading edge of the unit there, or the trailing edge of the one
   * before it at a line's end.
   *
   * @returns null when no line has a stop at `cluster`, as inside a grapheme.
   */
  pointAt(cluster: number): CaretPosition | null {
    const lineHeight = this.metrics.ascender - this.metrics.descender + (this.metrics.lineGap ?? 0);
    const stop =
      this.#carets.find(
        (candidate) =>
          candidate.unit === cluster && cluster < (this.lines[candidate.line]?.clusterEnd ?? 0) - 1,
      ) ?? this.#carets.find((candidate) => candidate.unit === cluster);
    const line = stop ? this.lines[stop.line] : undefined;
    if (!stop || !line) return null;
    return { x: this.origin.x + stop.x, y: line.y, lineHeight };
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
    for (const [lineIndex, line] of this.lines.entries()) {
      let left: number | null = null;
      let right: number | null = null;
      for (const placed of this.placedGlyphs) {
        if (placed.lineIndex !== lineIndex) continue;
        if (placed.glyph.cluster < range.start || placed.glyph.cluster >= range.end) continue;
        const glyphRight = placed.left + placed.glyph.xAdvance;
        left = left === null ? placed.left : Math.min(left, placed.left);
        right = right === null ? glyphRight : Math.max(right, glyphRight);
      }
      if (left !== null && right !== null) {
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
 * The name a glyph is drawn and listed by: its own, or for a character the
 * font has no glyph for, the name it would take.
 */
function glyphName(
  font: Font,
  items: readonly TextItem[],
  glyphId: GlyphId | null,
  start: number,
): GlyphName {
  if (glyphId) return (font.glyphName(glyphId) as GlyphName | null) ?? NOTDEF;
  const item = items[start];
  if (item?.kind !== "character") return NOTDEF;
  return font.nameForUnicode(item.codepoint as never);
}
