import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { alphabetical, ascending } from "@shift/types";
import { GlyphInfo } from "./GlyphInfo.js";
import { DEFAULT_LANGUAGE_IDS, type GlyphCategory } from "./types.js";
import { defaultResources } from "./resources.js";
import { coreResources } from "./coreResources.js";
import { componentResources } from "./componentResources.js";

let db: GlyphInfo;

beforeAll(() => {
  db = new GlyphInfo(defaultResources);
});

afterAll(() => {
  db.close();
});

describe("getGlyph", () => {
  it("returns full data for dollar sign", () => {
    const result = db.getGlyph(0x24);
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
    const result = db.getGlyph(0x41);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("A");
    expect(result!.category).toBe("Letter");
    expect(result!.script).toBe("latin");
  });

  it("returns null for codepoint not in Glyph.xml", () => {
    expect(db.getGlyph(0xfffe)).toBeNull();
  });

  it("returns data for space (U+0020)", () => {
    const result = db.getGlyph(0x20);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("space");
    expect(result!.category).toBe("Separator");
    expect(result!.subCategory).toBe("Space");
  });

  it("returns data with altNames field", () => {
    // bar (U+007C) has altNames="verticalbar"
    const result = db.getGlyph(0x7c);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("bar");
    expect(result!.altNames).toBe("verticalbar");
  });

  it("returns data with production field", () => {
    // nbspace (U+00A0) has production="uni00A0"
    const result = db.getGlyph(0xa0);
    expect(result).not.toBeNull();
    expect(result!.production).toBe("uni00A0");
  });

  it("returns null for negative codepoint", () => {
    expect(db.getGlyph(-1)).toBeNull();
  });

  it("returns null for codepoint beyond BMP", () => {
    expect(db.getGlyph(0x10000)).toBeNull();
  });

  it("returns null for surrogate codepoint", () => {
    expect(db.getGlyph(0xd800)).toBeNull();
  });

  it("returns data for digit zero", () => {
    const result = db.getGlyph(0x30);
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

describe("resolveGlyphName", () => {
  it("maps legacy aliases from the glyph database", () => {
    expect(db.resolveGlyphName("afii10072")).toBe("zhe-cy");
    expect(db.resolveGlyphName("afii10081")).toBe("pe-cy");
  });

  it("uses the assigned codepoint when the authored name is noncanonical", () => {
    expect(db.resolveGlyphName("custom-zhe", 0x0436)).toBe("zhe-cy");
  });

  it("maps production names and preserves dot suffixes", () => {
    expect(db.resolveGlyphName("uni01C9.sc")).toBe("lj.sc");
  });

  it("preserves unknown authored names", () => {
    expect(db.resolveGlyphName("custom.unencoded")).toBe("custom.unencoded");
  });
});

describe("unencoded glyph data", () => {
  it("finds positional forms, half forms and ligatures by name", () => {
    expect(db.getGlyphByName("beh-ar.init")).toMatchObject({
      codepoint: null,
      script: "arabic",
      production: "uni0628.init",
    });
    expect(db.getGlyphByName("k-deva")).toMatchObject({ codepoint: null, subCategory: "Halfform" });
    expect(db.getGlyphByName("lam_alef-ar")).toMatchObject({
      codepoint: null,
      subCategory: "Ligature",
    });
  });

  it("resolves a form's production name to its glyph data name", () => {
    expect(db.resolveGlyphName("uni0628.init")).toBe("beh-ar.init");
  });
});

describe("getAllGlyph", () => {
  it("returns many entries", () => {
    const all = db.getAllGlyph();
    expect(all.length).toBeGreaterThan(100);
  });

  it("every entry has required fields", () => {
    const incomplete = db
      .getAllGlyph()
      .filter(
        (g) =>
          typeof g.codepoint !== "number" ||
          typeof g.name !== "string" ||
          g.name.length === 0 ||
          typeof g.category !== "string" ||
          g.category.length === 0,
      );

    expect(incomplete).toEqual([]);
  });

  it("contains no duplicate codepoints", () => {
    const all = db.getAllGlyph();
    const codepoints = all.map((g) => g.codepoint);
    const uniqueCodepoints = new Set(codepoints);
    expect(uniqueCodepoints.size).toBe(codepoints.length);
  });

  it("codepoints are all non-negative integers", () => {
    const invalid = db
      .getAllGlyph()
      .filter((g) => g.codepoint === null || !Number.isInteger(g.codepoint) || g.codepoint < 0);

    expect(invalid).toEqual([]);
  });
});

describe("getGlyphCategories", () => {
  it("returns sorted unique categories", () => {
    const categories = db.getGlyphCategories();
    expect(categories.length).toBeGreaterThan(0);
    expect(categories).toContain("Letter");
    expect(categories).toContain("Symbol");
    const sorted = categories.toSorted();
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
    expect(db.getGlyphsByCategory("NonExistent" as GlyphCategory)).toEqual([]);
  });

  it("all returned glyphs match the requested category", () => {
    const symbols = db.getGlyphsByCategory("Symbol");
    for (const g of symbols) {
      expect(g.category).toBe("Symbol");
    }
  });

  it("category results are consistent with getAllGlyph", () => {
    const all = db.getAllGlyph();
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

describe("language coverage catalogs", () => {
  it("reports full coverage, and coverage of what a language adds beyond Basic", () => {
    const catalog = db.createLanguageCatalog(encoded([0x41, 0x42, 0x61, 0x24, 0xe6]));
    const english = catalog.coverage("eng-latin");

    expect(english?.language.name).toBe("English");
    expect([english?.fullPresentCount, english?.fullRequiredCount]).toEqual([4, 56]);
    // English adds Æ æ Œ œ to Latin's Basic A–Z a–z.
    expect([english?.presentCount, english?.requiredCount]).toEqual([1, 4]);
  });

  it("filters the font's glyphs by a set while preserving font order", () => {
    const catalog = db.createLanguageCatalog(encoded([0x42, 0x24, 0xe6, 0x41, 0x61]), [
      "eng-latin",
    ]);

    expect(catalog.filter("latin/basic")).toEqual(["B", "A", "a"]);
    expect(catalog.filter("eng-latin")).toEqual(["ae"]);
    expect(catalog.filter("unknown-language")).toEqual([]);
  });

  it("lists every required character in codepoint order, named from glyph data", () => {
    const required = db.createLanguageCatalog([]).requiredFully("eng-latin");

    expect(required).toHaveLength(56);
    expect(required[0]).toEqual({ name: "A", codepoint: 0x41, characters: [0x41], position: null });
    const codepoints = required.map(({ codepoint }) => codepoint ?? -1);
    expect(codepoints).toEqual(codepoints.toSorted(ascending));
    expect(db.createLanguageCatalog([]).required("unknown-language")).toEqual([]);
  });

  it("requires an Arabic letter's positional forms after the letter", () => {
    const names = db
      .createLanguageCatalog([])
      .requiredFully("arb-arabic")
      .map(({ name }) => name);
    const beh = names.indexOf("beh-ar");

    expect(names.slice(beh, beh + 4)).toEqual([
      "beh-ar",
      "beh-ar.fina",
      "beh-ar.medi",
      "beh-ar.init",
    ]);
    expect(names).toContain("lam_alef-ar");
    expect(names).not.toContain("beh-ar.isol");
  });

  it("counts a form by its production name and a letter by its codepoint", () => {
    const catalog = db.createLanguageCatalog(
      [
        { name: "uni0628.init", unicodes: [] },
        { name: "myBeh", unicodes: [0x0628] },
      ],
      ["arb-arabic"],
    );
    const behInit = catalog.requiredFully("arb-arabic").find(({ name }) => name === "beh-ar.init");

    expect(behInit && catalog.has(behInit)).toBe(true);
    expect(catalog.coverage("arb-arabic")?.fullPresentCount).toBe(2);
    expect(catalog.filter("arabic/basic")).toEqual(["uni0628.init", "myBeh"]);
  });

  it("requires Devanagari half forms built from a consonant and virama", () => {
    const halfForm = db
      .createLanguageCatalog([])
      .requiredFully("hin-devanagari")
      .find(({ name }) => name === "k-deva");

    expect(halfForm).toEqual({
      name: "k-deva",
      codepoint: null,
      characters: [0x0915, 0x094d],
      position: null,
    });
  });

  it("leaves Latin locale alternates and optional ligatures out of a language", () => {
    const names = db
      .createLanguageCatalog([])
      .required("eng-latin")
      .map(({ name }) => name);

    expect(names).not.toContain("idotaccent");
    expect(names).not.toContain("f_f_i");
  });

  it("groups tracked languages by script and skips unknown ids", () => {
    const catalog = db.createLanguageCatalog(
      [],
      ["rus-cyrillic", "eng-latin", "fra-latin", "nope"],
    );
    const scripts = catalog.trackedScripts;

    expect(scripts.map(({ script }) => script)).toEqual(["Cyrillic", "Latin"]);
    expect(scripts[1]?.languages.map(({ language }) => language.id)).toEqual([
      "eng-latin",
      "fra-latin",
    ]);
  });

  it("gives tracked Arabic a dotless Basic Shapes group and a Ligatures group", () => {
    const catalog = db.createLanguageCatalog([], ["arb-arabic"]);
    const arabic = catalog.trackedScripts.find(({ script }) => script === "Arabic");
    const shapes = catalog.required("arabic/basic-shapes").map(({ name }) => name);

    expect(arabic?.groups.map(({ group }) => group.name)).toEqual([
      "Basic Shapes",
      "Basic",
      "Punctuation",
      "Mirrored",
      "Ligatures",
    ]);
    expect(shapes).toContain("behDotless-ar.init");
    expect(shapes).toContain("fehDotless-ar.fina");
    expect(shapes).not.toContain("beh-ar");
  });

  it("draws Basic Shapes from Unicode's skeleton of each tracked letter", () => {
    const arabic = db
      .createLanguageCatalog([], ["arb-arabic"])
      .required("arabic/basic-shapes")
      .map(({ name }) => name);
    const withUrdu = db
      .createLanguageCatalog([], ["arb-arabic", "urd-arabic"])
      .required("arabic/basic-shapes")
      .map(({ name }) => name);

    // Teh, theh and beh share dotless beh; teh marbuta's skeleton is ae (dotless teh marbuta).
    expect(arabic).toEqual(expect.arrayContaining(["behDotless-ar", "ae-ar"]));
    expect(arabic).not.toContain("teh-ar");
    expect(arabic).not.toContain("gaf-ar");
    expect(withUrdu).toContain("gaf-ar");
  });

  it("gives a script without dotted letters no Basic Shapes group", () => {
    const catalog = db.createLanguageCatalog([], ["eng-latin", "hin-devanagari"]);
    const groupNames = catalog.trackedScripts.flatMap(({ groups }) =>
      groups.map(({ group }) => group.name),
    );

    expect(groupNames).not.toContain("Basic Shapes");
  });

  it("limits a script's ligatures to the tracked languages' characters", () => {
    const kurdish = db.createLanguageCatalog([], ["ckb-arabic"]);
    const arabic = db.createLanguageCatalog([], ["arb-arabic"]);
    const language = kurdish.coverage("ckb-arabic")?.language;
    const available = new Set([
      ...(language?.baseCodepoints ?? []),
      ...(language?.markCodepoints ?? []),
    ]);
    const ligatures = kurdish.required("arabic/ligatures");

    expect(ligatures.length).toBeLessThan(arabic.required("arabic/ligatures").length);
    expect(
      ligatures.filter(({ characters }) => !characters.every((c) => available.has(c))),
    ).toEqual([]);
  });

  it("resolves every default language id", () => {
    const catalog = db.createLanguageCatalog([]);

    for (const languageId of DEFAULT_LANGUAGE_IDS) {
      expect(catalog.coverage(languageId)?.language.id).toBe(languageId);
    }
  });

  it("sorts scripts and languages alphabetically", () => {
    const catalog = db.createLanguageCatalog([]);
    const scripts = catalog.scripts.map(({ script }) => script);
    const latin = catalog.scripts.find((script) => script.script === "Latin");
    const languageNames = latin?.languages.map(({ language }) => language.name) ?? [];

    expect(scripts).toEqual(scripts.toSorted(alphabetical));
    expect(languageNames).toEqual(languageNames.toSorted(alphabetical));
  });
});

/** Font glyphs encoding each codepoint, named as glyph data names them. */
function encoded(codepoints: readonly number[]) {
  return codepoints.map((codepoint) => ({
    name: db.getGlyphName(codepoint) ?? `uni${codepoint.toString(16)}`,
    unicodes: [codepoint],
  }));
}

describe("script groups from Unicode data", () => {
  const groupNames = (catalog: ReturnType<GlyphInfo["createLanguageCatalog"]>, script: string) =>
    catalog.trackedScripts
      .find((entry) => entry.script === script)
      ?.groups.map(({ group }) => group.name) ?? [];
  const characters = (catalog: ReturnType<GlyphInfo["createLanguageCatalog"]>, setId: string) =>
    catalog.required(setId).flatMap(({ codepoint }) => (codepoint === null ? [] : [codepoint]));

  it("requires a casing alternate only where SpecialCasing gives the language its own rules", () => {
    const catalog = db.createLanguageCatalog([]);
    const has = (languageId: string) =>
      catalog.required(languageId).some(({ name }) => name === "idotaccent");

    expect(has("tur-latin")).toBe(true);
    expect(has("eng-latin")).toBe(false);
  });

  it("lists Indic half forms and vowel signs in reading order", () => {
    const catalog = db.createLanguageCatalog([], ["hin-devanagari"]);
    const halfForms = catalog.required("devanagari/half-forms").map(({ name }) => name);

    expect(groupNames(catalog, "Devanagari")).toEqual(
      expect.arrayContaining(["Half Forms", "Vowel Signs"]),
    );
    expect(halfForms).toContain("k-deva");
    // Vowel sign I sits before its consonant, so it leads; vowel sign U sits below.
    expect(characters(catalog, "devanagari/vowel-signs")[0]).toBe(0x093f);
    expect(characters(catalog, "devanagari/vowel-signs").at(-1)).not.toBe(0x093f);
  });

  it("adds a script's own punctuation to its languages'", () => {
    const catalog = db.createLanguageCatalog([], ["arb-arabic"]);

    expect(characters(catalog, "arabic/punctuation")).toEqual(
      expect.arrayContaining([0x060c, 0x061b, 0x061f]),
    );
  });

  it("gives right-to-left scripts the mirrored pairs of their punctuation", () => {
    const catalog = db.createLanguageCatalog([], ["arb-arabic", "eng-latin"]);

    expect(characters(catalog, "arabic/mirrored")).toEqual(
      expect.arrayContaining([0x28, 0x29, 0xab, 0xbb]),
    );
    expect(groupNames(catalog, "Latin")).not.toContain("Mirrored");
  });

  it("gives Han-writing languages the Unihan core set of each region", () => {
    const catalog = db.createLanguageCatalog([], ["cmn-chinese"]);

    expect(groupNames(catalog, "Chinese")).toEqual(
      expect.arrayContaining(["Core: China", "Core: Taiwan", "Core: Japan", "Core: South Korea"]),
    );
    expect(catalog.required("chinese/core-g").length).toBeGreaterThan(8000);
  });
});

describe("type-design language groups hold for every language", () => {
  const languages = defaultResources.languages;
  const byId = new Map(languages.map((language) => [language.id, language]));
  // One catalog tracking every language holds every script's groups.
  let everyLanguage: ReturnType<GlyphInfo["createLanguageCatalog"]>;
  beforeAll(() => {
    everyLanguage = db.createLanguageCatalog(
      [],
      languages.map(({ id }) => id),
    );
  });
  const catalog = () => everyLanguage;
  const encodedNeeds = (languageId: string) =>
    catalog()
      .requiredFully(languageId)
      .flatMap(({ codepoint }) => (codepoint === null ? [] : [codepoint]));

  it("never requires a presentation form or a format control", () => {
    const presentationForm = (codepoint: number) =>
      (codepoint >= 0xfb00 && codepoint <= 0xfdff) || (codepoint >= 0xfe70 && codepoint <= 0xfeff);
    const offending = languages.flatMap((language) =>
      encodedNeeds(language.id)
        .filter(
          (codepoint) =>
            presentationForm(codepoint) || /\p{Cf}/u.test(String.fromCodePoint(codepoint)),
        )
        .map((codepoint) => `${language.id} U+${codepoint.toString(16)}`),
    );

    expect(offending).toEqual([]);
  });

  it("folds each language under a listed language of the same script", () => {
    const misfolded = languages.filter(({ coveredBy, script }) => {
      if (coveredBy === null) return false;

      const cover = byId.get(coveredBy);
      return cover?.coveredBy !== null || cover?.script !== script;
    });

    expect(misfolded.map(({ id }) => id)).toEqual([]);
  });

  it("lists every default language in its own right", () => {
    expect(DEFAULT_LANGUAGE_IDS.filter((id) => byId.get(id)?.coveredBy !== null)).toEqual([]);
  });

  it("gives every joining letter its positional forms, and no glyph twice", () => {
    const joining = new Map(
      defaultResources.unicode.joining.map(({ codepoint, type }) => [codepoint, type]),
    );
    const formsByType = { D: 3, R: 1, L: 1 } as const;
    const problems = languages.flatMap((language) => {
      const required = catalog().requiredFully(language.id);
      const names = required.map(({ name }) => name);
      const duplicate = names.length !== new Set(names).size ? [`${language.id} duplicates`] : [];
      const missingForms = required.flatMap(({ codepoint, name }) => {
        const type = codepoint === null ? undefined : joining.get(codepoint);
        if (!type) return [];

        const forms = names.filter((other) => other.startsWith(`${name}.`)).length;
        return forms === formsByType[type] ? [] : [`${language.id} ${name} has ${forms} forms`];
      });
      return [...duplicate, ...missingForms];
    });

    expect(problems).toEqual([]);
  });

  it("lists only what a language adds beyond its script's Basic set", () => {
    const overlapping = languages.flatMap((language) => {
      const key = language.script.toLowerCase();
      const basic = new Set(
        catalog()
          .required(`${key}/basic`)
          .map(({ name }) => name),
      );
      return catalog()
        .required(language.id)
        .filter(({ name }) => basic.has(name))
        .map(({ name }) => `${language.id} ${name}`);
    });

    expect(overlapping).toEqual([]);
  });

  it("weighs Basic by speakers, so Q is basic Latin and Ω basic Greek", () => {
    const basic = (languageId: string, setId: string) =>
      db
        .createLanguageCatalog([], [languageId])
        .required(setId)
        .flatMap(({ codepoint }) => (codepoint === null ? [] : [codepoint]));

    expect(basic("eng-latin", "latin/basic")).toEqual(expect.arrayContaining([0x51, 0x71]));
    expect(basic("ell-greek", "greek/basic")).toContain(0x03a9);
  });

  it("folds copies and dialects, and lists varieties that need more", () => {
    const standardArabic = catalog().coverage("arb-arabic");

    expect(byId.get("arq-arabic")?.coveredBy).toBe("arb-arabic");
    expect(standardArabic?.covers.map(({ id }) => id)).toContain("arq-arabic");
    expect(standardArabic?.varieties.map(({ language }) => language.id)).toContain("afb-arabic");
    expect(byId.get("ind-latin")?.coveredBy).not.toBeNull();
  });

  it("keeps a language that borrows another's alphabet from chaining its macrolanguage in", () => {
    // Qashqa'i (Azerbaijani macrolanguage) writes with Persian's letters.
    expect(byId.get("azb-arabic")?.coveredBy).toBeNull();
  });

  it("gives a copied orthography the marks it does not list", () => {
    // Kangri copies Dogri's letters; without Dogri's virama it would lose its half forms.
    const kangri = catalog()
      .requiredFully("xnr-devanagari")
      .map(({ name }) => name);

    expect(kangri).toContain("k-deva");
  });

  it("derives positional forms GlyphData does not list, from Unicode joining types", () => {
    const pashto = catalog()
      .requiredFully("pbu-arabic")
      .map(({ name }) => name);

    expect(pashto).toEqual(expect.arrayContaining(["tehRing-ar.init", "tehRing-ar.fina"]));
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

describe("category helpers", () => {
  it("resolves known codepoint category metadata", () => {
    const result = db.getCategoryForCodepoint(0x24);
    expect(result).toEqual({
      category: "Symbol",
      subCategoryKey: "Currency",
      subCategoryLabel: "Currency",
      isKnown: true,
    });
  });

  it("resolves unknown codepoint using defaults", () => {
    const result = db.getCategoryForCodepoint(0xfffe);
    expect(result).toEqual({
      category: "Other",
      subCategoryKey: "__null_subcategory__",
      subCategoryLabel: "General",
      isKnown: false,
    });
  });

  it("supports overriding fallback labels", () => {
    const result = db.getCategoryForCodepoint(0xfffe, {
      unknownCategoryLabel: "Unknown",
      nullSubCategoryKey: "none",
      nullSubCategoryLabel: "None",
    });
    expect(result).toEqual({
      category: "Unknown",
      subCategoryKey: "none",
      subCategoryLabel: "None",
      isKnown: false,
    });
  });

  it("builds sorted category summaries with subcategory counts", () => {
    const summaries = db.getCategorySummaries([0x24, 0x20, 0x30, 0xfffe]);
    expect(summaries.map((summary) => summary.category)).toEqual([
      "Number",
      "Other",
      "Separator",
      "Symbol",
    ]);

    const symbolSummary = summaries.find((summary) => summary.category === "Symbol");
    expect(symbolSummary).toBeDefined();
    expect(symbolSummary!.count).toBe(1);
    expect(symbolSummary!.subCategories).toEqual([
      { key: "Currency", label: "Currency", count: 1 },
    ]);
  });

  it("can exclude unknown codepoints from summaries", () => {
    const summaries = db.getCategorySummaries([0x24, 0xfffe], { includeUnknown: false });
    expect(summaries.map((summary) => summary.category)).toEqual(["Symbol"]);
  });

  it("filters by category and subcategory", () => {
    const codepoints = [0x24, 0xa3, 0x20, 0x30, 0xfffe];
    const categoryOnly = db.filterCodepoints(codepoints, { category: "Symbol" });
    expect(categoryOnly).toEqual([0x24, 0xa3]);

    const subCategory = db.filterCodepoints(codepoints, {
      category: "Symbol",
      subCategoryKey: "Currency",
    });
    expect(subCategory).toEqual([0x24, 0xa3]);
  });

  it("filters by full-text query while preserving input order", () => {
    const codepoints = [0x41, 0x42, 0x24, 0x21];
    const filtered = db.filterCodepoints(codepoints, { query: "exclam" });
    expect(filtered).toEqual([0x21]);
  });

  it("returns empty list for subcategory without category", () => {
    const codepoints = [0x24, 0x23, 0x20];
    const filtered = db.filterCodepoints(codepoints, { subCategoryKey: "Currency" });
    expect(filtered).toEqual([]);
  });

  it("can exclude unknown codepoints from filtering", () => {
    const codepoints = [0x24, 0xfffe];
    const filtered = db.filterCodepoints(codepoints, {}, { includeUnknown: false });
    expect(filtered).toEqual([0x24]);
  });

  it("creates reusable catalogs with summaries and filtering", () => {
    const catalog = db.createCategoryCatalog([0x24, 0xa3, 0x30, 0xfffe]);
    expect(catalog.categories.map((summary) => summary.category)).toEqual([
      "Number",
      "Other",
      "Symbol",
    ]);

    const symbolOnly = catalog.filter({ category: "Symbol" });
    expect(symbolOnly).toEqual([0x24, 0xa3]);
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
    // Most Adobe Latin 1 codepoints should be in Glyph.xml
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

    const glyphData = db.getGlyph(0x24);
    expect(glyphData).not.toBeNull();
    expect(dollarResult!.glyphName).toBe(glyphData!.name);
  });
});

describe("component resources loaded later", () => {
  it("answers names at once and decomposition and search once added", () => {
    const info = new GlyphInfo(coreResources);
    expect(info.getGlyphName(0xe9)).toBe("eacute");
    expect(info.hasComponentResources).toBe(false);
    expect(info.getDecomposition(0xe9)).toEqual([]);
    expect(info.search("eacute")).toEqual([]);

    info.addResources(componentResources);
    expect(info.hasComponentResources).toBe(true);
    expect(info.getDecomposition(0xe9)).toEqual(db.getDecomposition(0xe9));
    expect(info.search("eacute")).toEqual(db.search("eacute"));
  });
});
