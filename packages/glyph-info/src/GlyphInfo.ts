import MiniSearch from "minisearch";
import type {
  CharsetDefinition,
  CharsetSummary,
  GlyphCategory,
  GlyphCategoryCatalog,
  GlyphCategorySummary,
  GlyphCodepointFilter,
  GlyphCategoryOptions,
  GlyphCodepointCategory,
  Glyph,
  GlyphInfoResources,
  SearchResult,
} from "./types.js";

const DEFAULT_GLYPH_CATEGORY_OPTIONS: Required<GlyphCategoryOptions> = {
  includeUnknown: true,
  unknownCategoryLabel: "Other",
  nullSubCategoryKey: "__null_subcategory__",
  nullSubCategoryLabel: "General",
};

interface GlyphSearchHit {
  id: number;
  codepoint: number;
  glyphName: string | null;
  unicodeName: string | null;
  category: GlyphCategory | null;
  subCategory: string | null;
  score: number;
}

function resolveGlyphCategoryOptions(
  options?: GlyphCategoryOptions,
): Required<GlyphCategoryOptions> {
  if (!options) {
    return DEFAULT_GLYPH_CATEGORY_OPTIONS;
  }

  return {
    includeUnknown: options?.includeUnknown ?? DEFAULT_GLYPH_CATEGORY_OPTIONS.includeUnknown,
    unknownCategoryLabel:
      options?.unknownCategoryLabel ?? DEFAULT_GLYPH_CATEGORY_OPTIONS.unknownCategoryLabel,
    nullSubCategoryKey:
      options?.nullSubCategoryKey ?? DEFAULT_GLYPH_CATEGORY_OPTIONS.nullSubCategoryKey,
    nullSubCategoryLabel:
      options?.nullSubCategoryLabel ?? DEFAULT_GLYPH_CATEGORY_OPTIONS.nullSubCategoryLabel,
  };
}

type GlyphCategoryEntry = {
  codepoint: number;
  category: GlyphCategory;
  subCategoryKey: string;
};

type GlyphCategoryCountBucket = {
  count: number;
  subCategoryCounts: Map<string, { label: string; count: number }>;
};

type GlyphCategoryCatalogData = {
  categories: GlyphCategorySummary[];
  entries: GlyphCategoryEntry[];
};

function incrementCategoryCounts(
  categoryCounts: Map<GlyphCategory, GlyphCategoryCountBucket>,
  categoryInfo: GlyphCodepointCategory,
): void {
  let categoryBucket = categoryCounts.get(categoryInfo.category);
  if (!categoryBucket) {
    categoryBucket = { count: 0, subCategoryCounts: new Map() };
    categoryCounts.set(categoryInfo.category, categoryBucket);
  }
  categoryBucket.count += 1;

  const existingSubCategory = categoryBucket.subCategoryCounts.get(categoryInfo.subCategoryKey);
  if (existingSubCategory) {
    existingSubCategory.count += 1;
    return;
  }

  categoryBucket.subCategoryCounts.set(categoryInfo.subCategoryKey, {
    label: categoryInfo.subCategoryLabel,
    count: 1,
  });
}

function toSortedCategorySummaries(
  categoryCounts: Map<GlyphCategory, GlyphCategoryCountBucket>,
): GlyphCategorySummary[] {
  const summaries: GlyphCategorySummary[] = [];

  for (const [category, bucket] of categoryCounts.entries()) {
    const subCategories: GlyphCategorySummary["subCategories"] = [];
    for (const [key, subCategory] of bucket.subCategoryCounts.entries()) {
      subCategories.push({
        key,
        label: subCategory.label,
        count: subCategory.count,
      });
    }
    subCategories.sort((a, b) => a.label.localeCompare(b.label));

    summaries.push({
      category,
      count: bucket.count,
      subCategories,
    });
  }

  summaries.sort((a, b) => a.category.localeCompare(b.category));
  return summaries;
}

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
  #glyphData: Map<number, Glyph>;
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
  getGlyph(cp: number): Glyph | null {
    return this.#glyphData.get(cp) ?? null;
  }

  /** Shorthand for the production glyph name. Returns `null` if the codepoint is not in the database. */
  getGlyphName(cp: number): string | null {
    const data = this.#glyphData.get(cp);
    if (!data) return null;

    return data.name;
  }

  getAllGlyph(): Glyph[] {
    return Array.from(this.#glyphData.values());
  }

  getGlyphCategories(): GlyphCategory[] {
    const categories = new Set<GlyphCategory>();
    for (const g of this.#glyphData.values()) {
      categories.add(g.category);
    }
    return Array.from(categories).sort();
  }

  getGlyphsByCategory(category: GlyphCategory): Glyph[] {
    const results: Glyph[] = [];
    for (const g of this.#glyphData.values()) {
      if (g.category === category) {
        results.push(g);
      }
    }
    return results;
  }

  /**
   * Resolve a codepoint into UI-friendly category metadata.
   * Unknown codepoints are assigned default labels from {@link GlyphCategoryOptions}.
   */
  getCategoryForCodepoint(cp: number, options?: GlyphCategoryOptions): GlyphCodepointCategory {
    return this.#getCategoryForCodepoint(cp, resolveGlyphCategoryOptions(options));
  }

  /**
   * Build a reusable category catalog for a codepoint set.
   * The returned `filter()` uses MiniSearch for query matching and preserves input order.
   */
  createCategoryCatalog(
    codepoints: number[],
    options?: GlyphCategoryOptions,
  ): GlyphCategoryCatalog {
    const resolvedOptions = resolveGlyphCategoryOptions(options);
    const data = this.#buildCategoryCatalogData(codepoints, resolvedOptions);

    return {
      categories: data.categories,
      filter: (filter: GlyphCodepointFilter = {}) => this.#filterCategoryCatalog(data, filter),
    };
  }

  /**
   * Return grouped category/subcategory summaries for a codepoint set.
   */
  getCategorySummaries(
    codepoints: number[],
    options?: GlyphCategoryOptions,
  ): GlyphCategorySummary[] {
    return this.createCategoryCatalog(codepoints, options).categories;
  }

  /**
   * Filter a codepoint list by category/subcategory and optional full-text query.
   * Returned codepoints preserve input order.
   */
  filterCodepoints(
    codepoints: number[],
    filter: GlyphCodepointFilter = {},
    options?: GlyphCategoryOptions,
  ): number[] {
    const catalog = this.createCategoryCatalog(codepoints, options);
    return catalog.filter(filter);
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
    }) as unknown as GlyphSearchHit[];

    return results.slice(0, limit).map((result) => ({
      codepoint: result.codepoint ?? result.id,
      glyphName: result.glyphName ?? null,
      unicodeName: result.unicodeName ?? null,
      category: result.category ?? null,
      subCategory: result.subCategory ?? null,
      rank: result.score,
    }));
  }

  /** Release resources. Currently a no-op (MiniSearch is in-memory). */
  close(): void {
    // No-op — MiniSearch is in-memory, no resources to release
  }

  #getCategoryForCodepoint(
    codepoint: number,
    options: Required<GlyphCategoryOptions>,
  ): GlyphCodepointCategory {
    const glyphData = this.#glyphData.get(codepoint);
    if (!glyphData) {
      return {
        category: options.unknownCategoryLabel as GlyphCategory,
        subCategoryKey: options.nullSubCategoryKey,
        subCategoryLabel: options.nullSubCategoryLabel,
        isKnown: false,
      };
    }

    return {
      category: glyphData.category,
      subCategoryKey: glyphData.subCategory ?? options.nullSubCategoryKey,
      subCategoryLabel: glyphData.subCategory ?? options.nullSubCategoryLabel,
      isKnown: true,
    };
  }

  #buildCategoryCatalogData(
    codepoints: number[],
    options: Required<GlyphCategoryOptions>,
  ): GlyphCategoryCatalogData {
    const categoryCounts = new Map<GlyphCategory, GlyphCategoryCountBucket>();
    const entries: GlyphCategoryEntry[] = [];

    for (const codepoint of codepoints) {
      const categoryInfo = this.#getCategoryForCodepoint(codepoint, options);
      if (!options.includeUnknown && !categoryInfo.isKnown) {
        continue;
      }

      const { category, subCategoryKey } = categoryInfo;
      entries.push({ codepoint, category, subCategoryKey });
      incrementCategoryCounts(categoryCounts, categoryInfo);
    }

    return {
      categories: toSortedCategorySummaries(categoryCounts),
      entries,
    };
  }

  #filterCategoryCatalog(data: GlyphCategoryCatalogData, filter: GlyphCodepointFilter): number[] {
    const selectedCategory = filter.category ?? null;
    const selectedSubCategoryKey = filter.subCategoryKey ?? null;
    const query = filter.query ?? "";

    if (selectedSubCategoryKey !== null && selectedCategory === null) {
      return [];
    }

    const trimmedQuery = query.trim();
    let searchMatches: Set<number> | null = null;
    if (trimmedQuery.length > 0) {
      const searchLimit = filter.searchLimit ?? Math.max(data.entries.length, 200);
      const searchResults = this.search(trimmedQuery, searchLimit);
      searchMatches = new Set(searchResults.map((result) => result.codepoint));
    }

    const filtered: number[] = [];
    for (const entry of data.entries) {
      if (selectedCategory !== null && entry.category !== selectedCategory) {
        continue;
      }
      if (selectedSubCategoryKey !== null && entry.subCategoryKey !== selectedSubCategoryKey) {
        continue;
      }
      if (searchMatches !== null && !searchMatches.has(entry.codepoint)) {
        continue;
      }
      filtered.push(entry.codepoint);
    }

    return filtered;
  }
}
