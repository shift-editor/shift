import type { Point2D } from "@shift/geo";
import {
  type GlyphName,
  mintTextItemId,
  type GlyphId,
  type SourceMetrics,
  type TextItemId,
  type Unicode,
} from "@shift/types";
import type { Font } from "../../model/Font";

export type { TextItemId };

/**
 * A single item in a text buffer: a typed character, a glyph picked by
 * identity, or a structural line break. Line breaks are NOT glyphs — they
 * never get positioned; the layout splits on them into paragraphs.
 */
export type TextItem = ParagraphItem | LineBreakTextItem;

/** An item inside a paragraph: everything but the line breaks that separate paragraphs. */
export type ParagraphItem = CharacterTextItem | GlyphTextItem;

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

/**
 * Returns the glyph an item shows before shaping.
 *
 * @remarks
 * A character goes through the font's Unicode mapping only, the way a shaper
 * maps it, so a glyph that merely has the conventional name is not used.
 * Reads without tracking; reactive callers track `Font.glyphEntriesCell`.
 *
 * @returns null when the font maps no glyph to the character, or the picked glyph is gone.
 */
export function glyphIdForItem(item: ParagraphItem, font: Font): GlyphId | null {
  const entry =
    item.kind === "character"
      ? font.entryForUnicode(item.codepoint as Unicode)
      : font.entryForId(item.glyphId);
  return entry?.id ?? null;
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
}

export type Direction = "ltr" | "rtl";

/**
 * Which of a caret stop's places the caret shows at: the stop's own, or, at
 * a direction boundary, its second place, on the other run's edge.
 */
export type CaretEdge = "primary" | "secondary";

/** Where a caret stands: the boundary before `unit`, at its stop's `edge` place. */
export interface CaretTarget {
  readonly unit: number;
  readonly edge: CaretEdge;
}

/** One place a caret can show on a line, where Rust put it on screen. */
export interface CaretPlace extends CaretTarget {
  readonly x: number;
  /** The direction of the text the place is an edge of. */
  readonly direction: Direction;
}

export interface PositionedRun {
  glyphs: PositionedGlyph[];
  direction: Direction;
  script?: string | null;
  language?: string;
  features?: Record<string, boolean | "auto">;
  advance: number;
}

export interface Line {
  /** Runs in screen order, left to right. */
  runs: PositionedRun[];
  /** The paragraph's base direction. */
  direction: Direction;
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
}

/** A selection highlight on one line, in layout coordinates. */
export interface SelectionRect {
  readonly x: number;
  readonly width: number;
  readonly top: number;
  readonly bottom: number;
}

export interface CaretPosition {
  x: number;
  y: number;
  lineHeight: number;
}

export type { Point2D, SourceMetrics };
