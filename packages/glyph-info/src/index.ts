/**
 * `@shift/glyph-info` -- Unicode glyph metadata, decomposition, charset
 * membership, and full-text search.
 *
 * Instantiate {@link GlyphInfo} with a {@link GlyphInfoResources} bundle
 * (produced by the `generate:glyph-info` script) to get fast, in-memory
 * lookups. Use {@link defaultResources} for the pre-built dataset shipped
 * with the package.
 *
 * ```ts
 * import { GlyphInfo, defaultResources } from "@shift/glyph-info";
 * const info = new GlyphInfo(defaultResources());
 * info.search("latin capital");
 * ```
 *
 * @packageDocumentation
 */

export { GlyphInfo } from "./GlyphInfo.js";

/** Load the default pre-built resource bundle. */
export { defaultResources } from "./resources.js";

export { GLYPH_CATEGORIES } from "./types.js";
export type {
  /** Full metadata record for a single Unicode codepoint. */
  CharsetDefinition,
  /** Lightweight summary returned by `GlyphInfo.listCharsets()`. */
  CharsetSummary,
  /** Bidirectional codepoint decomposition maps. */
  Decomposition,
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
  /** A single hit from `GlyphInfo.search()`, ranked by relevance. */
  SearchResult,
} from "./types.js";
