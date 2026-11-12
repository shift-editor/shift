/**
 * `@shift/glyph-info` -- Unicode glyph metadata, decomposition, charset and
 * language coverage, and full-text search.
 *
 * Instantiate {@link GlyphInfo} with a {@link GlyphInfoResources} bundle
 * (produced by the `generate:glyph-info` script) to get fast, in-memory
 * lookups. Use {@link defaultResources} for the pre-built dataset shipped
 * with the package.
 *
 * ```ts
 * import { GlyphInfo, defaultResources } from "@shift/glyph-info";
 * const info = new GlyphInfo(defaultResources);
 * info.search("latin capital");
 * ```
 *
 * @packageDocumentation
 */

export { GlyphInfo } from "./GlyphInfo.js";

/** Text that renders a required glyph, joined when it is a positional form. */
export { glyphPreviewText } from "./glyphSets.js";

/** Load the default pre-built resource bundle. */
export { defaultResources } from "./resources.js";

/** The pre-built core resources alone, for apps that load component data later. */
export { coreResources } from "./coreResources.js";

export { DEFAULT_LANGUAGE_IDS, GLYPH_CATEGORIES } from "./types.js";
export type {
  /** Full metadata record for a single Unicode codepoint. */
  CharsetDefinition,
  /** Lightweight summary returned by `GlyphInfo.listCharsets()`. */
  CharsetSummary,
  /** Bidirectional codepoint decomposition maps. */
  Decomposition,
  /** A font glyph as language coverage reads it: its name and Unicode values. */
  FontGlyph,
  /** The position of a joining letter's form within a word. */
  GlyphPosition,
  /** Known Unicode general category for glyph classification. */
  GlyphCategory,
  /** Category fallback and inclusion options for codepoint categorization APIs. */
  GlyphCategoryOptions,
  /** Reusable category catalog with summaries and filtering. */
  GlyphCategoryCatalog,
  /** Resolved category/subcategory metadata for an individual codepoint. */
  GlyphCodepointCategory,
  /** Filter arguments used by `GlyphInfo.filterCodepoints()`. */
  GlyphCodepointFilter,
  /** Category summary with subcategory counts. */
  GlyphCategorySummary,
  /** Subcategory summary entry used inside `GlyphCategorySummary`. */
  GlyphSubCategorySummary,
  /** Per-codepoint glyph metadata (name, category, script, etc.). */
  Glyph,
  /** Bundle of all resources needed to construct a {@link GlyphInfo} instance. */
  GlyphInfoResources,
  /** Names, categories, charsets, and languages. */
  GlyphInfoCoreResources,
  /** Decomposition and search data, loadable after construction. */
  GlyphInfoComponentResources,
  /** Represents a primary language orthography and its required base-character repertoire. */
  Language,
  /** Provides reusable language coverage grouped by script. */
  LanguageCatalog,
  /** A variety folded under another language, with the glyphs it needs beyond it. */
  LanguageVariety,
  /** Reports coverage of one language orthography within a font. */
  LanguageCoverage,
  /** Groups language coverage entries sharing a script. */
  LanguageScript,
  /** Where an Indic vowel sign sits around its consonant. */
  IndicPosition,
  /** Unicode character properties glyph sets read. */
  UnicodeProperties,
  /** A joining-script letter and the dotless skeleton it is drawn on. */
  LetterSkeleton,
  /** A glyph a language or script group requires, by name. */
  RequiredGlyph,
  /** A glyph set a script needs beside its languages, such as Basic Shapes. */
  ScriptGroup,
  /** Reports coverage of one script group within a font. */
  ScriptGroupCoverage,
  /** A single hit from `GlyphInfo.search()`, ranked by relevance. */
  SearchResult,
} from "./types.js";
