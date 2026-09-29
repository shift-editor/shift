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
  codepoint: number;
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
  baseCodepoints: number[];
}

export interface LanguageCoverage {
  language: Language;
  presentCount: number;
  requiredCount: number;
}

export interface LanguageScript {
  script: string;
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

export interface LanguageCatalog {
  /** Every known language, grouped by script. */
  scripts: LanguageScript[];
  /** Returns the font's codepoints that the language requires, in input order. */
  filter(languageId: string): number[];
  /** Returns coverage for one language, or `null` for an unknown id. */
  coverage(languageId: string): LanguageCoverage | null;
  /** Returns every codepoint the language requires, ascending. */
  required(languageId: string): number[];
  /** Groups the given languages by script, skipping unknown ids. */
  scriptsFor(languageIds: readonly string[]): LanguageScript[];
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

export interface GlyphInfoResources {
  glyphData: Glyph[];
  decomposition: Decomposition;
  charsets: CharsetDefinition[];
  languages: Language[];
  searchData: Record<string, unknown>[];
}
