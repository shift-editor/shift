import { readFileSync } from "node:fs";
import { join } from "node:path";
import MiniSearch from "minisearch";
import type { CharsetDefinition, CharsetSummary, GlyphData, SearchResult } from "./types.js";

interface DecompositionData {
  decomposed: Record<string, number[]>;
  usedBy: Record<string, number[]>;
}

export class GlyphInfo {
  #glyphData: Map<number, GlyphData>;
  #decomposed: Map<number, number[]>;
  #usedBy: Map<number, number[]>;
  #charsets: CharsetDefinition[];
  #searchIndex: MiniSearch;

  constructor(resourcesDir: string) {
    const glyphDataRaw: GlyphData[] = JSON.parse(
      readFileSync(join(resourcesDir, "glyph-data.json"), "utf-8"),
    );
    this.#glyphData = new Map(glyphDataRaw.map((g) => [g.codepoint, g]));

    const decompositionRaw: DecompositionData = JSON.parse(
      readFileSync(join(resourcesDir, "decomposition.json"), "utf-8"),
    );
    this.#decomposed = new Map(
      Object.entries(decompositionRaw.decomposed).map(([k, v]) => [Number(k), v]),
    );
    this.#usedBy = new Map(Object.entries(decompositionRaw.usedBy).map(([k, v]) => [Number(k), v]));

    this.#charsets = JSON.parse(readFileSync(join(resourcesDir, "charsets.json"), "utf-8"));

    const searchData = JSON.parse(readFileSync(join(resourcesDir, "search-data.json"), "utf-8"));
    this.#searchIndex = new MiniSearch({
      fields: ["glyphName", "unicodeName", "altNames", "category", "subCategory"],
      storeFields: ["codepoint", "glyphName", "unicodeName", "category", "subCategory"],
      idField: "codepoint",
      searchOptions: { prefix: true, combineWith: "AND" },
    });
    this.#searchIndex.addAll(searchData);
  }

  // --- Glyph Data (Map lookups) ---

  getGlyphData(cp: number): GlyphData | null {
    return this.#glyphData.get(cp) ?? null;
  }

  getGlyphName(cp: number): string | null {
    return this.#glyphData.get(cp)?.name ?? null;
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

  getDecomposition(cp: number): number[] {
    return this.#decomposed.get(cp) ?? [];
  }

  getUsedBy(cp: number): number[] {
    return this.#usedBy.get(cp) ?? [];
  }

  // --- Charsets (in-memory arrays) ---

  listCharsets(): CharsetSummary[] {
    return this.#charsets.map(({ id, name, source, codepoints }) => ({
      id,
      name,
      source,
      count: codepoints.length,
    }));
  }

  getCharsetCodepoints(id: string): number[] {
    const charset = this.#charsets.find((c) => c.id === id);
    return charset?.codepoints ?? [];
  }

  // --- Search (MiniSearch) ---

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

  close(): void {
    // No-op — MiniSearch is in-memory, no resources to release
  }
}
