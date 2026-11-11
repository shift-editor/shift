// TODO: Derive GlyphSubCategory and GlyphScript unions from GlyphData.xml during the generate step.

/** Known Unicode general categories used for glyph classification. */
export const GLYPH_CATEGORIES = [
  "Letter",
  "Mark",
  "Number",
  "Punctuation",
  "Separator",
  "Symbol",
  "Other",
] as const;

export type GlyphCategory = (typeof GLYPH_CATEGORIES)[number];

export interface Glyph {
  /**
   * The Unicode value; `null` for a glyph no character encodes, such as the
   * positional form `beh-ar.init`, the half form `k-deva` or the ligature `f_f_i`.
   */
  codepoint: number | null;
  name: string;
  category: GlyphCategory;
  subCategory: string | null; // TODO: narrow to GlyphSubCategory union
  script: string | null; // TODO: narrow to GlyphScript union
  production: string | null;
  altNames: string | null;
}

export interface CharsetDefinition {
  id: string; // TODO: narrow to CharsetId union once more charsets are added (e.g. "adobe-latin-1" | "adobe-latin-2" | ...)
  name: string;
  source: string; // TODO: narrow to CharsetSource union (e.g. "adobe" | "google" | "custom")
  codepoints: number[];
}

export interface CharsetSummary {
  id: string;
  name: string;
  source: string;
  count: number;
}

/** Represents a primary Hyperglot orthography and its required base-character repertoire. */
export interface Language {
  id: string;
  name: string;
  autonym: string | null;
  script: string;
  /** The script's ISO 15924 code, such as `Arab`. */
  scriptCode: string;
  baseCodepoints: number[];
  /**
   * Combining marks the orthography uses. Forms may be built from them (a
   * Devanagari half form is a consonant and virama), but they are not required.
   */
  markCodepoints: number[];
}

/** A glyph in a font, as language coverage reads it. */
export interface FontGlyph {
  readonly name: string;
  readonly unicodes: readonly number[];
}

/** A glyph a language or script group needs. */
export interface RequiredGlyph {
  /** The GlyphData name, or `uniXXXX` for a character GlyphData does not name. */
  name: string;
  /** The Unicode value; `null` for an unencoded form such as `beh-ar.init`. */
  codepoint: number | null;
  /** The characters the glyph shapes, in order: one for a letter, several for a ligature. */
  characters: number[];
  /**
   * The glyph's form within a joined word (`init`, `medi` or `fina`), so a
   * preview can join it; `null` for a glyph that is not a positional form.
   */
  position: GlyphPosition | null;
}

/** The position of a joining letter's form within a word. */
export type GlyphPosition = "init" | "medi" | "fina";

/** A glyph set a script needs beside its languages, such as Arabic's dotless Basic Shapes. */
export interface ScriptGroup {
  /** Unique among script groups and language ids, such as `arabic/basic-shapes`. */
  id: string;
  name: string;
  script: string;
}

export interface ScriptGroupCoverage {
  group: ScriptGroup;
  presentCount: number;
  requiredCount: number;
}

export interface LanguageCoverage {
  language: Language;
  presentCount: number;
  requiredCount: number;
}

export interface LanguageScript {
  script: string;
  /** Script-wide groups, listed before the languages: Basic Shapes, Ligatures. */
  groups: ScriptGroupCoverage[];
  languages: LanguageCoverage[];
}

/**
 * Languages tracked by a font that has not chosen its own list: the ten most
 * spoken languages by total speakers (Ethnologue), as Hyperglot orthography ids.
 */
export const DEFAULT_LANGUAGE_IDS = [
  "eng-latin",
  "cmn-chinese",
  "hin-devanagari",
  "spa-latin",
  "fra-latin",
  "arb-arabic",
  "ben-bengali",
  "por-latin",
  "rus-cyrillic",
  "urd-arabic",
] as const;

/**
 * Language and script-group coverage for one font. A set id names either a
 * language (`arb-arabic`) or a script group (`arabic/ligatures`).
 */
export interface LanguageCatalog {
  /** Every known language, grouped by script, with no script groups. */
  scripts: LanguageScript[];
  /**
   * The tracked languages grouped by script, each script with its groups;
   * unknown ids are skipped.
   */
  trackedScripts: LanguageScript[];
  /** Returns the names of the font's glyphs in a set, in font order. */
  filter(setId: string): string[];
  /** Returns coverage for one language, or `null` for an unknown id. */
  coverage(languageId: string): LanguageCoverage | null;
  /**
   * Returns every glyph a set requires: encoded glyphs by codepoint, then
   * forms in GlyphData order. Empty for an unknown id.
   */
  required(setId: string): RequiredGlyph[];
  /** Whether the font has a required glyph, by its codepoint or its name. */
  has(glyph: RequiredGlyph): boolean;
}

export interface SearchResult {
  codepoint: number;
  glyphName: string | null;
  unicodeName: string | null;
  category: GlyphCategory | null;
  subCategory: string | null;
  rank: number;
}

export interface GlyphCategoryOptions {
  includeUnknown?: boolean;
  unknownCategoryLabel?: string;
  nullSubCategoryKey?: string;
  nullSubCategoryLabel?: string;
}

export interface GlyphCodepointCategory {
  category: GlyphCategory;
  subCategoryKey: string;
  subCategoryLabel: string;
  isKnown: boolean;
}

export interface GlyphSubCategorySummary {
  key: string;
  label: string;
  count: number;
}

export interface GlyphCategorySummary {
  category: GlyphCategory;
  count: number;
  subCategories: GlyphSubCategorySummary[];
}

export interface GlyphCodepointFilter {
  category?: GlyphCategory | null;
  subCategoryKey?: string | null;
  query?: string;
  searchLimit?: number;
}

export interface GlyphCategoryCatalog {
  categories: GlyphCategorySummary[];
  filter(filter?: GlyphCodepointFilter): number[];
}

export interface Decomposition {
  decomposed: Record<string, number[]>;
  usedBy: Record<string, number[]>;
}

export interface GlyphInfoResources extends GlyphInfoCoreResources, GlyphInfoComponentResources {}

/** Names, categories, charsets, and languages: what glyph lists and catalogs need. */
export interface GlyphInfoCoreResources {
  glyphData: Glyph[];
  charsets: CharsetDefinition[];
  languages: Language[];
}

/**
 * Decomposition and full-text search data, used to suggest and find components.
 *
 * About 10 MB of the 17 MB dataset; apps that start with the core resources
 * load these when they first need them and pass them to `GlyphInfo.addResources`.
 */
export interface GlyphInfoComponentResources {
  decomposition: Decomposition;
  searchData: Record<string, unknown>[];
}
