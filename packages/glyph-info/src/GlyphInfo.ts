import MiniSearch from "minisearch";
import type {
  CharsetDefinition,
  CharsetSummary,
  GlyphData,
  GlyphInfoResources,
  SearchResult,
} from "./types.js";

/**
 * In-memory Unicode glyph information database.
 *
 * Provides constant-time lookups for glyph metadata, codepoint
 * decomposition, charset membership, and prefix-based full-text search
 * powered by MiniSearch.
 *
 * Construct with a {@link GlyphInfoResources} bundle. Call {@link close}
 * when done (currently a no-op, but present for future resource cleanup).
 */
export class GlyphInfo {
  #glyphData: Map<number, GlyphData>;
  #decomposed: Map<number, number[]>;
  #usedBy: Map<number, number[]>;
  #charsets: CharsetDefinition[];
  #searchIndex: MiniSearch;

  constructor(resources: GlyphInfoResources) {
    this.#glyphData = new Map(resources.glyphData.map((g) => [g.codepoint, g]));

    this.#decomposed = new Map(
      Object.entries(resources.decomposition.decomposed).map(([k, v]) => [Number(k), v]),
    );
    this.#usedBy = new Map(
      Object.entries(resources.decomposition.usedBy).map(([k, v]) => [Number(k), v]),
    );

    this.#charsets = resources.charsets;

    this.#searchIndex = new MiniSearch({
      fields: ["glyphName", "unicodeName", "altNames", "category", "subCategory"],
      storeFields: ["codepoint", "glyphName", "unicodeName", "category", "subCategory"],
      idField: "codepoint",
      searchOptions: { prefix: true, combineWith: "AND" },
    });
    this.#searchIndex.addAll(resources.searchData);
  }

  // --- Glyph Data (Map lookups) ---

  /** Look up the full metadata record for a codepoint, or `null` if unknown. */
  getGlyphData(cp: number): GlyphData | null {
    return this.#glyphData.get(cp) ?? null;
  }

  /** Shorthand for the production glyph name. Returns `null` if the codepoint is not in the database. */
  getGlyphName(cp: number): string | null {
    const data = this.#glyphData.get(cp);
    if (!data) return null;

    return data.name;
  }

  getAllGlyphData(): GlyphData[] {
    return Array.from(this.#glyphData.values());
  }

  getGlyphCategories(): string[] {
    const categories = new Set<string>();
    for (const g of this.#glyphData.values()) {
      categories.add(g.category);
    }
    return Array.from(categories).sort();
  }

  getGlyphsByCategory(category: string): GlyphData[] {
    const results: GlyphData[] = [];
    for (const g of this.#glyphData.values()) {
      if (g.category === category) {
        results.push(g);
      }
    }
    return results;
  }

  // --- Decomposition (Map lookups) ---

  /**
   * Return the codepoints that `cp` decomposes into (e.g. an accented letter
   * into base + combining mark). Empty array if no decomposition exists.
   */
  getDecomposition(cp: number): number[] {
    return this.#decomposed.get(cp) ?? [];
  }

  /**
   * Return codepoints that use `cp` as a component in their decomposition
   * (the reverse of {@link getDecomposition}).
   */
  getUsedBy(cp: number): number[] {
    return this.#usedBy.get(cp) ?? [];
  }

  // --- Charsets (in-memory arrays) ---

  /** Return a summary (id, name, source, count) for every loaded charset. */
  listCharsets(): CharsetSummary[] {
    return this.#charsets.map(({ id, name, source, codepoints }) => ({
      id,
      name,
      source,
      count: codepoints.length,
    }));
  }

  /** Return the codepoints belonging to a charset, or an empty array if the ID is unknown. */
  getCharsetCodepoints(id: string): number[] {
    const charset = this.#charsets.find((c) => c.id === id);
    return charset?.codepoints ?? [];
  }

  // --- Search (MiniSearch) ---

  /**
   * Full-text prefix search across glyph names, Unicode names, and categories.
   * @param query Free-text query string. Special characters are stripped.
   * @param limit Maximum number of results (default 50).
   * @returns Results ranked by relevance score.
   */
  search(query: string, limit = 50): SearchResult[] {
    if (!query.trim()) return [];

    const sanitized = query.trim().replace(/['"()*:^{}]/g, " ");
    if (!sanitized.trim()) return [];

    const results = this.#searchIndex.search(sanitized, {
      prefix: true,
      combineWith: "AND",
    });

    return results.slice(0, limit).map((r) => ({
      codepoint: r.codepoint as number,
      glyphName: (r.glyphName as string | null) ?? null,
      unicodeName: (r.unicodeName as string | null) ?? null,
      category: (r.category as string | null) ?? null,
      subCategory: (r.subCategory as string | null) ?? null,
      rank: r.score,
    }));
  }

  /** Release resources. Currently a no-op (MiniSearch is in-memory). */
  close(): void {
    // No-op — MiniSearch is in-memory, no resources to release
  }
}
