import type { FontMetrics, Point2D } from "@shift/types";
import type { Bounds } from "@shift/geo";

/**
 * A single item in a text buffer. Either a glyph (typed character or picked
 * variant) or a structural line break. Line breaks are NOT glyphs — they
 * never get positioned; the layout splits on them into paragraphs.
 */
export type Cell = GlyphCell | LineBreak;

export interface GlyphCell {
  kind: "glyph";
  glyphName: string;
  /** Source codepoint when typed via keyboard; null when picked from a glyph UI. */
  codepoint: number | null;
}

export interface LineBreak {
  kind: "linebreak";
}

/** Build a glyph cell. `codepoint` is null when the source isn't a typed character. */
export function glyphCell(glyphName: string, codepoint: number | null = null): GlyphCell {
  return { kind: "glyph", glyphName, codepoint };
}

/** Singleton linebreak cell — structural paragraph separator. */
export const linebreak: LineBreak = { kind: "linebreak" };

export interface PositionedGlyph {
  glyphName: string;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
  cluster: number;
  bounds: Bounds | null;
}

export type Direction = "ltr" | "rtl";

export interface SegmentedRun {
  glyphs: readonly GlyphCell[];
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
  glyphs: readonly GlyphCell[];
  clusterStart: number;
}

export type { FontMetrics, Point2D };
