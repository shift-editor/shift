import type { NodeId, ParagraphRequest, RunId, ShapedParagraph, TextItemId } from "@shift/types";
import type { TextAlign, TextItem } from "../lib/text/layout/types";

export type { TextAlign };

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

/**
 * How a run's text is shaped and set: the fields of its record that the
 * Text section edits.
 */
export type TextRunSettings = Pick<
  TextRunRecord,
  "shaping" | "language" | "script" | "lineHeight" | "align"
>;

/** One paragraph's shaping, with the text it was shaped from. */
export interface ShapedTextParagraph {
  /** The paragraph's characters and picked glyphs; equal keys shape alike. */
  readonly key: string;
  /** Null for a paragraph that could not be shaped, which lays out literally. */
  readonly shaped: ShapedParagraph | null;
}

/** One paragraph's shaping request, with the key of the text it asks for. */
export interface ParagraphShapingRequest {
  readonly key: string;
  readonly request: ParagraphRequest;
}

/** What a run asks the shaper for, paragraph by paragraph. */
export interface ShapingRequest {
  readonly paragraphs: readonly ParagraphShapingRequest[];
}

/** The settings every paragraph of a run is shaped with. */
export type ShapingSettings = Pick<ParagraphRequest, "features" | "language" | "script">;

/** What a feature does when text does not set it, as the shaper reports it. */
export type FeatureDefault = "required" | "on" | "off";

/** A feature the font's compiled feature code defines. */
export interface FontFeature {
  /** The feature tag, such as `liga` or `ss01`. */
  readonly tag: string;
  /** The name a `featureNames` block gives a stylistic set or character variant. */
  readonly name: string | null;
  /** Required features shape every text and are never switched. */
  readonly default: FeatureDefault;
}
