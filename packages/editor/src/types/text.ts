import type { Point2D } from "@shift/geo";
import type { GlyphId, NodeId, RunId, SourceId, TextItemId } from "@shift/types";
import type { FontFeature, PlacedText, TextAlign } from "@shift/wasm/protocol";
import type { PageNode } from "./node";
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

/**
 * The features a font's shaper font defines, as Rust lists them, or why
 * they could not be listed.
 */
export type FeatureListing =
  | { readonly kind: "listed"; readonly features: readonly FontFeature[] }
  | { readonly kind: "failed"; readonly error: unknown };

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

/** Where `Text.placeRun` puts a new run, and what it starts with. */
export interface RunPlacement {
  /** The page the run goes on. */
  readonly page: PageNode;
  /** The run's origin, in the page's (scene) space. */
  readonly at: Point2D;
  /** The glyphs the run starts with, in order; empty for a run to type into. */
  readonly glyphs: readonly GlyphId[];
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
 * Text and Features sections edit.
 */
export type TextRunSettings = Pick<
  TextRunRecord,
  "shaping" | "features" | "language" | "script" | "lineHeight" | "align"
>;

/**
 * A run record as the store may hold it: one saved before a setting
 * existed lacks it. `Text` gives each missing setting its default when it
 * reads the run, so every other reader sees a whole {@link TextRunRecord}.
 */
export type StoredTextRunRecord = Omit<TextRunRecord, keyof TextRunSettings> &
  Partial<TextRunSettings>;
