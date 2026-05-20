import type { Bounds, Point2D } from "@shift/geo";
import type { FontMetrics } from "@shift/types";

export type TextItemId = string;
export type TextRunId = string;

export interface GlyphAnchor {
  runId: TextRunId;
  itemId: TextItemId;
}

let nextItemId = 1;

export function createTextItemId(): TextItemId {
  const id = `item_${nextItemId}`;
  nextItemId += 1;
  return id;
}

/**
 * A single item in a text buffer. Either a glyph (typed character or picked
 * variant) or a structural line break. Line breaks are NOT glyphs — they
 * never get positioned; the layout splits on them into paragraphs.
 */
export type TextItem = GlyphTextItem | LineBreakTextItem;

export interface GlyphTextItem {
  id: TextItemId;
  kind: "glyph";
  glyphName: string;
  /** Source codepoint when typed via keyboard; null when picked from a glyph UI. */
  codepoint: number | null;
}

export interface LineBreakTextItem {
  id: TextItemId;
  kind: "linebreak";
}

/** Build a glyph text item. `codepoint` is null when the source isn't a typed character. */
export function glyphTextItem(
  glyphName: string,
  codepoint: number | null = null,
  id: TextItemId = createTextItemId(),
): GlyphTextItem {
  return { id, kind: "glyph", glyphName, codepoint };
}

/** Build a line break text item — structural paragraph separator. */
export function lineBreakTextItem(
  id: TextItemId = createTextItemId(),
): LineBreakTextItem {
  return { id, kind: "linebreak" };
}

export interface PositionedGlyph {
  glyphName: string;
  sourceItemIds: readonly TextItemId[];
  origin: Point2D;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
  cluster: number;
  bounds: Bounds | null;
}

export type Direction = "ltr" | "rtl";

export interface SegmentedRun {
  glyphs: readonly GlyphTextItem[];
  direction: Direction;
  script?: string;
  language?: string;
  features?: Record<string, boolean | "auto">;
  clusterStart: number;
}

export interface PositionedRun {
  glyphs: PositionedGlyph[];
  direction: Direction;
  script?: string;
  language?: string;
  features?: Record<string, boolean | "auto">;
  advance: number;
}

export interface Line {
  runs: PositionedRun[];
  y: number;
  ascent: number;
  descent: number;
  /** First cluster index that belongs to this line (inclusive). */
  clusterStart: number;
  /**
   * One past the last cluster on this line — `clusterStart + glyphs.length + 1`
   * (the +1 covers either the trailing linebreak's cluster or the after-last
   * caret position on the final line).
   */
  clusterEnd: number;
}

export interface Hit {
  lineIndex: number;
  runIndex: number;
  cluster: number;
  side: "left" | "right";
}

export interface CaretPosition {
  x: number;
  y: number;
  lineHeight: number;
}

export interface ParagraphSlice {
  glyphs: readonly GlyphTextItem[];
  clusterStart: number;
}

export type { FontMetrics, Point2D };
