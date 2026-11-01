import type { Point2D } from "@shift/geo";
import type { GlyphId, GlyphName, NodeId, RunId, TextItemId } from "@shift/types";
import type { PageNode } from "./node";
import type { TextItem } from "../lib/text/layout/types";

/** Caret immediately after an item; null denotes the start of a run. */
export type TextCaret = TextItemId | null;

declare const TextEditingIdBrand: unique symbol;
export type TextEditingId = string & {
  readonly [TextEditingIdBrand]: typeof TextEditingIdBrand;
};
export const currentTextEditingId = "textEditing:current" as TextEditingId;

export interface TextSelectionRange {
  readonly start: number;
  readonly end: number;
}

/** Session-only editing focus for one placed proof text node. */
export interface TextEditingRecord {
  readonly id: TextEditingId;
  readonly type: "textEditing";
  readonly scope: "session";
  readonly nodeId: NodeId;
  readonly anchor: TextCaret;
  readonly focus: TextCaret;
  /**
   * Whether Text mode is showing this caret. An inactive record keeps the
   * caret and selection for the next visit.
   */
  readonly active: boolean;
}

/** Where `Text.placeRun` puts a new run, and what it starts with. */
export interface RunPlacement {
  /** The page the run goes on. */
  readonly page: PageNode;
  /** The run's origin, in the page's (scene) space. */
  readonly at: Point2D;
  /** The glyphs the run starts with, in order; empty for a run to type into. */
  readonly glyphs: readonly GlyphId[];
}

/** Where `Text.addRun` puts a new run, and the items it holds. */
export interface RunContent {
  /** The page the run goes on. */
  readonly page: PageNode;
  /** The run's origin, in the page's (scene) space. */
  readonly at: Point2D;
  readonly items: readonly TextItem[];
}

/** Text parsed into items, and each `/name` in it that names no glyph in the font. */
export interface ParsedText {
  readonly items: TextItem[];
  /** Names the parser asked for and the font lacks, in the order they appear; such a name stays literal text. */
  readonly unknownGlyphNames: readonly GlyphName[];
}

/** Stores document-scoped proof text content. */
export interface TextRunRecord {
  readonly id: RunId;
  readonly type: "textrun";
  readonly scope: "document";
  readonly items: readonly TextItem[];
}
