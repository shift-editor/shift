import { existsSync, readFileSync, unlinkSync } from "node:fs";
import Database from "better-sqlite3";
import { unicodeName } from "unicode-name";
import type { GlyphData } from "../../src/types.js";

export function generateSearchIndex(glyphDataPath: string, outputPath: string): number {
  if (existsSync(outputPath)) {
    unlinkSync(outputPath);
  }

  const db = new Database(outputPath);

  db.exec(`
    CREATE VIRTUAL TABLE search_index USING fts5(
      codepoint UNINDEXED,
      glyph_name,
      unicode_name,
      alt_names,
      category,
      sub_category
    );
  `);

  const glyphDataRaw: GlyphData[] = JSON.parse(readFileSync(glyphDataPath, "utf-8"));
  const glyphMap = new Map(glyphDataRaw.map((g) => [g.codepoint, g]));

  const insert = db.prepare(`
    INSERT INTO search_index (codepoint, glyph_name, unicode_name, alt_names, category, sub_category)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let count = 0;

  const insertAll = db.transaction(() => {
    for (let cp = 0x0000; cp <= 0xffff; cp++) {
      // Skip surrogates
      if (cp >= 0xd800 && cp <= 0xdfff) continue;

      const uniName = unicodeName(cp) ?? null;
      const glyph = glyphMap.get(cp);

      // Skip codepoints that have neither unicode name nor glyph data
      if (!uniName && !glyph) continue;

      insert.run(
        cp,
        glyph?.name ?? null,
        uniName,
        glyph?.altNames ?? null,
        glyph?.category ?? null,
        glyph?.subCategory ?? null,
      );
      count++;
    }
  });

  insertAll();
  db.close();

  return count;
}
