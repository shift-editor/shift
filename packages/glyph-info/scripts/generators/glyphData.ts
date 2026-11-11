import { readFileSync, writeFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import type { GlyphCategory, Glyph } from "../../src/types.js";

interface XmlGlyph {
  unicode?: string;
  name: string;
  category: string;
  subCategory?: string;
  script?: string;
  production?: string;
  altNames?: string;
}

export function generateGlyph(xmlPath: string, outputPath: string): number {
  const xml = readFileSync(xmlPath, "utf-8");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    isArray: (tagName) => tagName === "glyph",
  });

  const parsed = parser.parse(xml);
  const glyphs: XmlGlyph[] = parsed.glyphData.glyph;

  const results: Glyph[] = [];

  for (const g of glyphs) {
    // Unencoded entries are positional forms, half forms and ligatures, kept by name.
    const codepoint = g.unicode ? parseInt(g.unicode, 16) : null;
    if (codepoint !== null && isNaN(codepoint)) continue;

    results.push({
      codepoint,
      name: g.name,
      category: g.category as GlyphCategory,
      subCategory: g.subCategory ?? null,
      script: g.script ?? null,
      production: g.production ?? null,
      altNames: g.altNames ?? null,
    });
  }

  results.sort(encodedFirst);
  writeFileSync(outputPath, JSON.stringify(results, null, 2));

  return results.length;
}

/** Orders encoded entries by codepoint, then unencoded ones in GlyphData order. */
function encodedFirst(left: Glyph, right: Glyph): number {
  if (left.codepoint === null) return right.codepoint === null ? 0 : 1;
  if (right.codepoint === null) return -1;

  return left.codepoint - right.codepoint;
}
