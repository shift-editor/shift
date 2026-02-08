import { readFileSync, writeFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import type { GlyphData } from "../../src/types.js";

interface XmlGlyph {
  unicode?: string;
  name: string;
  category: string;
  subCategory?: string;
  script?: string;
  production?: string;
  altNames?: string;
}

export function generateGlyphData(xmlPath: string, outputPath: string): number {
  const xml = readFileSync(xmlPath, "utf-8");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    isArray: (tagName) => tagName === "glyph",
  });

  const parsed = parser.parse(xml);
  const glyphs: XmlGlyph[] = parsed.glyphData.glyph;

  const results: GlyphData[] = [];

  for (const g of glyphs) {
    if (!g.unicode) continue;

    const codepoint = parseInt(g.unicode, 16);
    if (isNaN(codepoint)) continue;

    results.push({
      codepoint,
      name: g.name,
      category: g.category,
      subCategory: g.subCategory ?? null,
      script: g.script ?? null,
      production: g.production ?? null,
      altNames: g.altNames ?? null,
    });
  }

  results.sort((a, b) => a.codepoint - b.codepoint);
  writeFileSync(outputPath, JSON.stringify(results, null, 2));

  return results.length;
}
