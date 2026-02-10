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

export type {
  /** Full metadata record for a single Unicode codepoint. */
  CharsetDefinition,
  /** Lightweight summary returned by `GlyphInfo.listCharsets()`. */
  CharsetSummary,
  /** Bidirectional codepoint decomposition maps. */
  DecompositionData,
  /** Per-codepoint glyph metadata (name, category, script, etc.). */
  GlyphData,
  /** Bundle of all resources needed to construct a {@link GlyphInfo} instance. */
  GlyphInfoResources,
  /** A single hit from `GlyphInfo.search()`, ranked by relevance. */
  SearchResult,
} from "./types.js";
