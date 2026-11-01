import type { GlyphId, NodeId, RunId, TextItemId } from "@shift/types";
import type { TextAlign } from "@shift/wasm/protocol";
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
  /**
   * Features turned on (`true`) or off (`false`) for this text by tag, such
   * as `ss01`; a tag left out keeps the font's default.
   */
  readonly features: Readonly<Record<string, boolean>>;
  /**
   * The BCP 47 language the text is shaped as, such as `ur` or `tr`, which
   * picks the font's localized forms; null uses the font's default language.
   */
  readonly language: string | null;
  /**
   * An ISO 15924 script, such as `Arab`, that the whole text is shaped in;
   * null shapes each stretch in the script of its own characters.
   */
  readonly script: string | null;
  /**
   * The distance between baselines, in ems (1.5 is one and a half ems); null
   * uses the font's own line spacing: ascender, descender, and line gap.
   */
  readonly lineHeight: number | null;
  /** How lines line up; null follows each line's direction, so Arabic lines sit right. */
  readonly align: TextAlign | null;
}

/** A feature whose changes one run highlights, such as the one under the pointer. */
export interface FeatureHighlight {
  readonly runId: RunId;
  readonly tag: string;
}

/** Glyphs one run draws highlighted. */
export interface TextHighlight {
  readonly runId: RunId;
  readonly glyphs: ReadonlySet<GlyphId>;
}

/**
 * How a run's text is shaped and set: the fields of its record that the
 * Text and Features sections edit.
 */
export type TextRunSettings = Pick<
  TextRunRecord,
  "shaping" | "features" | "language" | "script" | "lineHeight" | "align"
>;
