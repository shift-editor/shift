import { readFileSync, writeFileSync } from "node:fs";
import { unicodeName } from "unicode-name";
import type { GlyphData } from "../../src/types.js";

export function generateSearchIndex(glyphDataPath: string, outputPath: string): number {
  const glyphDataRaw: GlyphData[] = JSON.parse(readFileSync(glyphDataPath, "utf-8"));
  const glyphMap = new Map(glyphDataRaw.map((g) => [g.codepoint, g]));

  const records: Array<{
    codepoint: number;
    glyphName: string | null;
    unicodeName: string | null;
    altNames: string | null;
    category: string | null;
    subCategory: string | null;
  }> = [];

  for (let cp = 0x0000; cp <= 0xffff; cp++) {
    // Skip surrogates
    if (cp >= 0xd800 && cp <= 0xdfff) continue;

    const uniName = unicodeName(cp) ?? null;
    const glyph = glyphMap.get(cp);

    // Skip codepoints that have neither unicode name nor glyph data
    if (!uniName && !glyph) continue;

    records.push({
      codepoint: cp,
      glyphName: glyph?.name ?? null,
      unicodeName: uniName,
      altNames: glyph?.altNames ?? null,
      category: glyph?.category ?? null,
      subCategory: glyph?.subCategory ?? null,
    });
  }

  writeFileSync(outputPath, JSON.stringify(records));

  return records.length;
}
