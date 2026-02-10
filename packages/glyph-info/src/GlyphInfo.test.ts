import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GlyphInfo } from "./GlyphInfo.js";
import { defaultResources } from "./resources.js";
import type { GlyphData, SearchResult } from "./types.js";

let db: GlyphInfo;

beforeAll(() => {
  db = new GlyphInfo(defaultResources);
});

afterAll(() => {
  db.close();
});

describe("getGlyphData", () => {
  it("returns full data for dollar sign", () => {
    const result = db.getGlyphData(0x24);
    expect(result).toEqual({
      codepoint: 0x24,
      name: "dollar",
      category: "Symbol",
      subCategory: "Currency",
      script: null,
      production: null,
      altNames: null,
    });
  });

  it("returns data for LATIN CAPITAL LETTER A", () => {
    const result = db.getGlyphData(0x41);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("A");
    expect(result!.category).toBe("Letter");
    expect(result!.script).toBe("latin");
  });

  it("returns null for codepoint not in GlyphData.xml", () => {
    expect(db.getGlyphData(0xfffe)).toBeNull();
  });

  it("returns data for space (U+0020)", () => {
    const result = db.getGlyphData(0x20);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("space");
    expect(result!.category).toBe("Separator");
    expect(result!.subCategory).toBe("Space");
  });

  it("returns data with altNames field", () => {
    // bar (U+007C) has altNames="verticalbar"
    const result = db.getGlyphData(0x7c);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("bar");
    expect(result!.altNames).toBe("verticalbar");
  });

  it("returns data with production field", () => {
    // nbspace (U+00A0) has production="uni00A0"
    const result = db.getGlyphData(0xa0);
    expect(result).not.toBeNull();
    expect(result!.production).toBe("uni00A0");
  });

  it("returns null for negative codepoint", () => {
    expect(db.getGlyphData(-1)).toBeNull();
  });

  it("returns null for codepoint beyond BMP", () => {
    expect(db.getGlyphData(0x10000)).toBeNull();
  });

  it("returns null for surrogate codepoint", () => {
    expect(db.getGlyphData(0xd800)).toBeNull();
  });

  it("returns data for digit zero", () => {
    const result = db.getGlyphData(0x30);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("zero");
    expect(result!.category).toBe("Number");
    expect(result!.subCategory).toBe("Decimal Digit");
  });
});

describe("getGlyphName", () => {
  it("returns name for dollar sign", () => {
    expect(db.getGlyphName(0x24)).toBe("dollar");
  });

  it("returns null for unknown codepoint", () => {
    expect(db.getGlyphName(0xfffe)).toBeNull();
  });

  it("returns name for lowercase letters", () => {
    expect(db.getGlyphName(0x61)).toBe("a");
    expect(db.getGlyphName(0x7a)).toBe("z");
  });

  it("returns name for punctuation", () => {
    expect(db.getGlyphName(0x2e)).toBe("period");
    expect(db.getGlyphName(0x2c)).toBe("comma");
  });
});

describe("getAllGlyphData", () => {
  it("returns many entries", () => {
    const all = db.getAllGlyphData();
    expect(all.length).toBeGreaterThan(100);
  });

  it("every entry has required fields", () => {
    const all = db.getAllGlyphData();
    for (const g of all) {
      expect(g.codepoint).toBeTypeOf("number");
      expect(g.name).toBeTypeOf("string");
      expect(g.name.length).toBeGreaterThan(0);
      expect(g.category).toBeTypeOf("string");
      expect(g.category.length).toBeGreaterThan(0);
    }
  });

  it("contains no duplicate codepoints", () => {
    const all = db.getAllGlyphData();
    const codepoints = all.map((g) => g.codepoint);
    const uniqueCodepoints = new Set(codepoints);
    expect(uniqueCodepoints.size).toBe(codepoints.length);
  });

  it("codepoints are all non-negative integers", () => {
    const all = db.getAllGlyphData();
    for (const g of all) {
      expect(g.codepoint).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(g.codepoint)).toBe(true);
    }
  });
});

describe("getGlyphCategories", () => {
  it("returns sorted unique categories", () => {
    const categories = db.getGlyphCategories();
    expect(categories.length).toBeGreaterThan(0);
    expect(categories).toContain("Letter");
    expect(categories).toContain("Symbol");
    const sorted = [...categories].sort();
    expect(categories).toEqual(sorted);
  });

  it("contains no duplicates", () => {
    const categories = db.getGlyphCategories();
    expect(new Set(categories).size).toBe(categories.length);
  });

  it("includes common font editing categories", () => {
    const categories = db.getGlyphCategories();
    expect(categories).toContain("Number");
    expect(categories).toContain("Punctuation");
    expect(categories).toContain("Separator");
  });
});

describe("getGlyphsByCategory", () => {
  it("returns glyphs in the Letter category", () => {
    const letters = db.getGlyphsByCategory("Letter");
    expect(letters.length).toBeGreaterThan(0);
    expect(letters.every((g) => g.category === "Letter")).toBe(true);
  });

  it("returns empty array for non-existent category", () => {
    expect(db.getGlyphsByCategory("NonExistent")).toEqual([]);
  });

  it("all returned glyphs match the requested category", () => {
    const symbols = db.getGlyphsByCategory("Symbol");
    for (const g of symbols) {
      expect(g.category).toBe("Symbol");
    }
  });

  it("category results are consistent with getAllGlyphData", () => {
    const all = db.getAllGlyphData();
    const categories = db.getGlyphCategories();
    let totalFromCategories = 0;
    for (const cat of categories) {
      totalFromCategories += db.getGlyphsByCategory(cat).length;
    }
    expect(totalFromCategories).toBe(all.length);
  });
});

describe("getDecomposition", () => {
  it("decomposes é (U+00E9) to e + combining acute", () => {
    const components = db.getDecomposition(0xe9);
    expect(components).toEqual([0x65, 0x301]);
  });

  it("returns empty array for a base character", () => {
    expect(db.getDecomposition(0x41)).toEqual([]);
  });

  it("decomposes ñ (U+00F1) to n + combining tilde", () => {
    const components = db.getDecomposition(0xf1);
    expect(components).toEqual([0x6e, 0x303]);
  });

  it("decomposes ü (U+00FC) to u + combining diaeresis", () => {
    const components = db.getDecomposition(0xfc);
    expect(components).toEqual([0x75, 0x308]);
  });

  it("returns empty for surrogate codepoint", () => {
    expect(db.getDecomposition(0xd800)).toEqual([]);
  });

  it("returns empty for negative codepoint", () => {
    expect(db.getDecomposition(-1)).toEqual([]);
  });

  it("decomposes fi ligature (U+FB01) into f + i", () => {
    const components = db.getDecomposition(0xfb01);
    expect(components).toContain(0x66); // f
    expect(components).toContain(0x69); // i
  });

  it("decomposes superscript 2 (U+00B2) to digit 2", () => {
    const components = db.getDecomposition(0xb2);
    expect(components).toContain(0x32); // 2
  });

  it("decomposition components are all valid codepoints", () => {
    // Spot-check several decomposable characters
    for (const cp of [0xe9, 0xf1, 0xfc, 0xc0, 0xd6]) {
      const components = db.getDecomposition(cp);
      for (const c of components) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(0xffff);
      }
    }
  });
});

describe("getUsedBy", () => {
  it("returns composed characters using e (U+0065)", () => {
    const usedBy = db.getUsedBy(0x65);
    expect(usedBy.length).toBeGreaterThan(0);
    expect(usedBy).toContain(0xe9); // é
    expect(usedBy).toContain(0xe8); // è
    expect(usedBy).toContain(0xea); // ê
    expect(usedBy).toContain(0xeb); // ë
  });

  it("returns empty array for a character not used as component", () => {
    expect(db.getUsedBy(0xfffe)).toEqual([]);
  });

  it("usedBy is sorted in ascending order", () => {
    const usedBy = db.getUsedBy(0x65);
    for (let i = 1; i < usedBy.length; i++) {
      expect(usedBy[i]).toBeGreaterThan(usedBy[i - 1]);
    }
  });

  it("combining acute (U+0301) is used by many accented characters", () => {
    const usedBy = db.getUsedBy(0x301);
    expect(usedBy.length).toBeGreaterThan(10);
    expect(usedBy).toContain(0xe9); // é
    expect(usedBy).toContain(0xc1); // Á
  });

  it("decomposition and usedBy are consistent", () => {
    // If é decomposes to [e, acute], then usedBy(e) should contain é
    const components = db.getDecomposition(0xe9);
    for (const comp of components) {
      const usedBy = db.getUsedBy(comp);
      expect(usedBy).toContain(0xe9);
    }
  });

  it("returns empty for negative codepoint", () => {
    expect(db.getUsedBy(-1)).toEqual([]);
  });
});

describe("listCharsets", () => {
  it("includes adobe-latin-1", () => {
    const charsets = db.listCharsets();
    expect(charsets.length).toBeGreaterThan(0);
    const al1 = charsets.find((c) => c.id === "adobe-latin-1");
    expect(al1).toBeDefined();
    expect(al1!.name).toBe("Adobe Latin 1");
    expect(al1!.source).toBe("adobe");
    expect(al1!.count).toBeGreaterThan(200);
  });

  it("summary count matches codepoints array length", () => {
    const charsets = db.listCharsets();
    for (const cs of charsets) {
      const codepoints = db.getCharsetCodepoints(cs.id);
      expect(cs.count).toBe(codepoints.length);
    }
  });

  it("does not expose codepoints array in summary", () => {
    const charsets = db.listCharsets();
    for (const cs of charsets) {
      expect(cs).not.toHaveProperty("codepoints");
    }
  });
});

describe("getCharsetCodepoints", () => {
  it("returns codepoints for adobe-latin-1", () => {
    const codepoints = db.getCharsetCodepoints("adobe-latin-1");
    expect(codepoints.length).toBeGreaterThan(200);
    expect(codepoints).toContain(0x41); // A
    expect(codepoints).toContain(0x24); // $
  });

  it("returns empty for unknown charset", () => {
    expect(db.getCharsetCodepoints("nonexistent")).toEqual([]);
  });

  it("contains basic ASCII letters and digits", () => {
    const codepoints = db.getCharsetCodepoints("adobe-latin-1");
    // A-Z
    for (let cp = 0x41; cp <= 0x5a; cp++) {
      expect(codepoints).toContain(cp);
    }
    // a-z
    for (let cp = 0x61; cp <= 0x7a; cp++) {
      expect(codepoints).toContain(cp);
    }
    // 0-9
    for (let cp = 0x30; cp <= 0x39; cp++) {
      expect(codepoints).toContain(cp);
    }
  });

  it("contains common accented characters", () => {
    const codepoints = db.getCharsetCodepoints("adobe-latin-1");
    expect(codepoints).toContain(0xe9); // é
    expect(codepoints).toContain(0xf1); // ñ
    expect(codepoints).toContain(0xfc); // ü
    expect(codepoints).toContain(0xe7); // ç
  });

  it("contains fi and fl ligatures", () => {
    const codepoints = db.getCharsetCodepoints("adobe-latin-1");
    expect(codepoints).toContain(0xfb01); // fi
    expect(codepoints).toContain(0xfb02); // fl
  });

  it("contains euro sign", () => {
    const codepoints = db.getCharsetCodepoints("adobe-latin-1");
    expect(codepoints).toContain(0x20ac);
  });

  it("codepoints are all valid non-negative integers", () => {
    const codepoints = db.getCharsetCodepoints("adobe-latin-1");
    for (const cp of codepoints) {
      expect(cp).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(cp)).toBe(true);
    }
  });

  it("returns empty string for empty id", () => {
    expect(db.getCharsetCodepoints("")).toEqual([]);
  });
});

describe("search", () => {
  it("finds dollar sign by name", () => {
    const results = db.search("dollar");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.codepoint === 0x24)).toBe(true);
  });

  it("finds arrow glyphs", () => {
    const results = db.search("arrow");
    expect(results.length).toBeGreaterThan(0);
  });

  it("supports prefix matching", () => {
    const results = db.search("dol");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.codepoint === 0x24)).toBe(true);
  });

  it("returns empty for empty query", () => {
    expect(db.search("")).toEqual([]);
  });

  it("returns empty for whitespace-only query", () => {
    expect(db.search("   ")).toEqual([]);
    expect(db.search("\t\n")).toEqual([]);
  });

  it("respects limit parameter", () => {
    const results = db.search("latin", 5);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it("default limit is 50", () => {
    const results = db.search("latin");
    expect(results.length).toBeLessThanOrEqual(50);
  });

  it("results have all required fields", () => {
    const results = db.search("dollar");
    for (const r of results) {
      expect(r.codepoint).toBeTypeOf("number");
      expect(r.rank).toBeTypeOf("number");
      // glyphName, unicodeName, category, subCategory can be null
    }
  });

  it("finds by unicode name", () => {
    const results = db.search("EXCLAMATION MARK");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.codepoint === 0x21)).toBe(true);
  });

  it("finds by glyph name", () => {
    const results = db.search("exclam");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.codepoint === 0x21)).toBe(true);
  });

  it("multi-word search narrows results", () => {
    const broad = db.search("latin");
    const narrow = db.search("latin capital");
    expect(narrow.length).toBeLessThanOrEqual(broad.length);
  });

  it("search with limit 1 returns at most 1 result", () => {
    const results = db.search("dollar", 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("results are ranked (rank values are present)", () => {
    const results = db.search("dollar");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.rank).toBeTypeOf("number");
    }
  });

  it("finds characters by category search", () => {
    const results = db.search("Currency");
    expect(results.length).toBeGreaterThan(0);
  });

  it("handles special characters gracefully", () => {
    // These should not crash — they may return no results
    expect(() => db.search('"')).not.toThrow();
    expect(() => db.search("(")).not.toThrow();
    expect(() => db.search(")")).not.toThrow();
  });
});

describe("cross-domain consistency", () => {
  it("charset codepoints that are in glyphData return valid glyph names", () => {
    const codepoints = db.getCharsetCodepoints("adobe-latin-1");
    let matchCount = 0;
    for (const cp of codepoints) {
      const name = db.getGlyphName(cp);
      if (name !== null) {
        matchCount++;
        expect(name.length).toBeGreaterThan(0);
      }
    }
    // Most Adobe Latin 1 codepoints should be in GlyphData.xml
    expect(matchCount).toBeGreaterThan(200);
  });

  it("decomposable characters in the charset can be looked up", () => {
    const codepoints = db.getCharsetCodepoints("adobe-latin-1");
    let decomposableCount = 0;
    for (const cp of codepoints) {
      const decomp = db.getDecomposition(cp);
      if (decomp.length > 0) {
        decomposableCount++;
        // Each component should be a valid codepoint
        for (const comp of decomp) {
          expect(comp).toBeGreaterThanOrEqual(0);
          expect(comp).toBeLessThanOrEqual(0xffff);
        }
      }
    }
    // Accented chars like é, ñ, ü etc. should decompose
    expect(decomposableCount).toBeGreaterThan(10);
  });

  it("searchable codepoints match glyph data lookups", () => {
    const searchResults = db.search("dollar");
    const dollarResult = searchResults.find((r) => r.codepoint === 0x24);
    expect(dollarResult).toBeDefined();

    const glyphData = db.getGlyphData(0x24);
    expect(glyphData).not.toBeNull();
    expect(dollarResult!.glyphName).toBe(glyphData!.name);
  });
});
