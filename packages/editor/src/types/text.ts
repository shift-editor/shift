import type { NodeId, RunId, SourceId, TextItemId } from "@shift/types";
import type { TextItem } from "../lib/text/layout/types";
import type { ExternalAxisLocation } from "./variation";

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
