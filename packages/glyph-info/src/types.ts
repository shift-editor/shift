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
  /** Punctuation the orthography uses; counted in the script's Punctuation group, not required. */
  punctuationCodepoints: number[];
  /** First- and second-language speakers, from Hyperglot; ranks a group's members. */
  speakers: number;
  /**
   * The orthography whose support covers this one for type design, or `null`
   * for one listed in its own right: Algerian Arabic is covered by Standard
   * Arabic, Indonesian by Malaysian.
   */
  coveredBy: string | null;
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

/** A script group and every glyph it requires. */
export interface ScriptGroupDefinition {
  readonly group: ScriptGroup;
  readonly required: RequiredGlyph[];
}

/** What a script's tracked languages share, for building its Unicode-derived groups. */
export interface ScriptGroupInput {
  /** Hyperglot script name, such as `Devanagari`. */
  readonly script: string;
  readonly languages: readonly Language[];
  readonly unicode: UnicodeProperties;
  /** Names a character's glyph. */
  readonly glyphFor: (codepoint: number) => RequiredGlyph;
}

export interface ScriptGroupCoverage {
  group: ScriptGroup;
  presentCount: number;
  requiredCount: number;
}

/**
 * Coverage of one language: of what it adds beyond its script's Basic set,
 * and of everything it needs.
 */
export interface LanguageCoverage {
  language: Language;
  /** Present glyphs among those the language adds beyond Basic. */
  presentCount: number;
  /** Glyphs the language adds beyond Basic. */
  requiredCount: number;
  /** Present glyphs among everything the language needs, Basic included. */
  fullPresentCount: number;
  fullRequiredCount: number;
  /** Languages this one's support covers fully: Standard Arabic covers Algerian Arabic. */
  covers: Language[];
  /**
   * Varieties folded under this language that need glyphs it lacks, with how
   * many: Gulf Arabic also uses پ ڤ گ.
   */
  varieties: LanguageVariety[];
}

/** A variety folded under another language, and the glyphs it needs beyond that language. */
export interface LanguageVariety {
  language: Language;
  extraCount: number;
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
   * Returns every glyph a set requires, each letter followed by its forms:
   * for a language, only what it adds beyond its script's Basic set. Empty
   * for an unknown id.
   */
  required(setId: string): RequiredGlyph[];
  /** Returns everything a language needs, its script's Basic set included. */
  requiredFully(languageId: string): RequiredGlyph[];
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

/** Unicode's Joining_Type of a letter that joins: dual, right or left. */
export type JoiningType = "D" | "R" | "L";

/** Where an Indic vowel sign sits around its consonant, from IndicPositionalCategory.txt. */
export type IndicPosition = "Left" | "Right" | "Top" | "Bottom";

/** Unicode character properties glyph sets read, generated from vendored UCD files. */
export interface UnicodeProperties {
  /** kUnihanCore2020 characters by region source: G China, H Hong Kong, J Japan, K Korea, M Macao, P North Korea, T Taiwan. */
  unihanCore: Record<string, number[]>;
  /** For each language tag with its own casing rules (tr, az, lt), every character the rules map. */
  specialCasing: Record<string, number[]>;
  /** Characters and the character right-to-left text shows in their place: `(` and `)`. */
  mirrors: { codepoint: number; mirror: number }[];
  /**
   * Letters that join their neighbours: `D` both sides (beh: init, medi and
   * fina forms), `R` the preceding letter only (reh: fina), `L` the following only (init).
   */
  joining: { codepoint: number; type: JoiningType }[];
  /** ISO 15924 codes of scripts written right to left. */
  rightToLeftScripts: string[];
  /** Punctuation each script uses as its own (Script or Script_Extensions), by ISO 15924 code. */
  scriptPunctuation: Record<string, number[]>;
  indic: {
    consonants: number[];
    viramas: number[];
    /** Dependent vowel signs (matras) and where each sits; `null` for a sign split around its consonant. */
    vowelSigns: { codepoint: number; position: IndicPosition | null }[];
  };
}

/** A joining-script letter and the dotless skeleton it is drawn on: teh on dotless beh. */
export interface LetterSkeleton {
  codepoint: number;
  skeleton: number;
}

export interface GlyphInfoResources extends GlyphInfoCoreResources, GlyphInfoComponentResources {}

/** Names, categories, charsets, and languages: what glyph lists and catalogs need. */
export interface GlyphInfoCoreResources {
  glyphData: Glyph[];
  charsets: CharsetDefinition[];
  languages: Language[];
  /** Each joining-script letter's dotless skeleton, from Unicode's ArabicShaping.txt. */
  skeletons: LetterSkeleton[];
  unicode: UnicodeProperties;
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
