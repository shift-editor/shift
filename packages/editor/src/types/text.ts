import type { NodeId, RunId, SourceId, TextItemId } from "@shift/types";
import type { PlacedText } from "@shift/wasm/protocol";
import type { CaretEdge, Direction, TextItem } from "../lib/text/layout/types";
import type { ExternalAxisLocation } from "./variation";

/**
 * Why a run's text has no layout, or why what its layout needed did not
 * load: `layout` when laying it out failed, `preload` when the engine could
 * not load glyphs the layout showed from placeholders, `module` when the
 * module that lays out a preview's text did not load.
 */
export interface TextLayoutFailure {
  readonly stage: "layout" | "preload" | "module";
  readonly error: unknown;
}

/** A run's text as Rust laid it out, or why laying it out failed. */
export type RunLaidOut =
  | { readonly kind: "placed"; readonly placed: PlacedText }
  | { readonly kind: "failed"; readonly failure: TextLayoutFailure };

/** Where text is laid out: the location shown, and the source edited, which takes precedence. */
export interface TextPlace {
  readonly location: ExternalAxisLocation;
  readonly sourceId: SourceId | null;
}

/** Caret immediately after an item; null denotes the start of a run. */
export type TextCaret = TextItemId | null;

declare const TextEditingIdBrand: unique symbol;
export type TextEditingId = string & {
  readonly [TextEditingIdBrand]: typeof TextEditingIdBrand;
};
export const currentTextEditingId = "textEditing:current" as TextEditingId;

/** A word's edge on one side on screen: the cluster there, and the direction the word reads in. */
export interface WordEdge {
  readonly unit: number;
  readonly direction: Direction;
}

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
   * Which of the focus stop's places the caret shows at: `secondary` only
   * where a move landed on the second place of a direction boundary.
   */
  readonly focusEdge: CaretEdge;
  /**
   * Whether Text mode is showing this caret. An inactive record keeps the
   * caret and selection for the next visit.
   */
  readonly active: boolean;
}

/** Stores document-scoped proof text content. */
export interface TextRunRecord {
  readonly id: RunId;
  readonly type: "textrun";
  readonly scope: "document";
  readonly items: readonly TextItem[];
  /**
   * Whether the font's feature code shapes the text; off lays out each item
   * as typed, glyph by glyph.
   */
  readonly shaping: boolean;
}
