import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
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
  #searchDb: Database.Database;

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

    this.#searchDb = new Database(join(resourcesDir, "search.db"), { readonly: true });
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

  // --- Search (FTS5) ---

  search(query: string, limit = 50): SearchResult[] {
    if (!query.trim()) return [];

    // Strip FTS5 special characters that would cause syntax errors
    const sanitized = query.trim().replace(/['"()*:^{}]/g, " ");
    if (!sanitized.trim()) return [];

    const ftsQuery = sanitized
      .trim()
      .split(/\s+/)
      .map((term) => `${term}*`)
      .join(" ");

    const rows = this.#searchDb
      .prepare(
        `SELECT codepoint, glyph_name, unicode_name, category, sub_category, rank
         FROM search_index
         WHERE search_index MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(ftsQuery, limit) as Array<{
      codepoint: number;
      glyph_name: string | null;
      unicode_name: string | null;
      category: string | null;
      sub_category: string | null;
      rank: number;
    }>;

    return rows.map((r) => ({
      codepoint: r.codepoint,
      glyphName: r.glyph_name,
      unicodeName: r.unicode_name,
      category: r.category,
      subCategory: r.sub_category,
      rank: r.rank,
    }));
  }

  close(): void {
    this.#searchDb.close();
  }
}
