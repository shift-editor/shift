import type { Bounds, Point2D } from "@shift/geo";
import {
  type GlyphName,
  mintTextItemId,
  type GlyphId,
  type SourceMetrics,
  type TextItemId,
} from "@shift/types";

export type { TextItemId };

/**
 * A single item in a text buffer: a typed character, a glyph picked by
 * identity, or a structural line break. Line breaks are NOT glyphs — they
 * never get positioned; the layout splits on them into paragraphs.
 */
export type TextItem = CharacterTextItem | GlyphTextItem | LineBreakTextItem;

/** An item that lays out as a glyph: everything but a line break. */
export type GlyphicTextItem = CharacterTextItem | GlyphTextItem;

/** A typed character; the font's Unicode mapping picks its glyph at layout time. */
export interface CharacterTextItem {
  id: TextItemId;
  kind: "character";
  codepoint: number;
}

/** A glyph picked by identity, such as an alternate with no Unicode value. */
export interface GlyphTextItem {
  id: TextItemId;
  kind: "glyph";
  glyphId: GlyphId;
}

export interface LineBreakTextItem {
  id: TextItemId;
  kind: "linebreak";
}

/** Build a character text item. */
export function characterTextItem(
  codepoint: number,
  id: TextItemId = mintTextItemId(),
): CharacterTextItem {
  return { id, kind: "character", codepoint };
}

/** Build a picked glyph text item. */
export function glyphTextItem(glyphId: GlyphId, id: TextItemId = mintTextItemId()): GlyphTextItem {
  return { id, kind: "glyph", glyphId };
}

/** Build a line break text item — structural paragraph separator. */
export function lineBreakTextItem(id: TextItemId = mintTextItemId()): LineBreakTextItem {
  return { id, kind: "linebreak" };
}

export interface PositionedGlyph {
  /** Stable document glyph identity resolved during layout; null when unresolved. */
  glyphId: GlyphId | null;
  glyphName: GlyphName;
  sourceItemIds: readonly TextItemId[];
  origin: Point2D;
  xAdvance: number;
  /**
   * Kerning with the next glyph, in font units, added after `xAdvance`. The
   * next glyph's origin includes it; the advance box `[left, left + xAdvance)`
   * does not.
   */
  xKern: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
  cluster: number;
  bounds: Bounds | null;
}

export type Direction = "ltr" | "rtl";

export interface SegmentedRun {
  items: readonly GlyphicTextItem[];
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
  items: readonly GlyphicTextItem[];
  clusterStart: number;
}

export type { Point2D, SourceMetrics };
