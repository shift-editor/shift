import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { UnicodeDB } from "./UnicodeDB.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "resources", "unicode.db");

let db: UnicodeDB;

beforeAll(() => {
  db = new UnicodeDB(DB_PATH);
});

afterAll(() => {
  db.close();
});

describe("getByCodepoint", () => {
  it("returns data for LATIN CAPITAL LETTER A", () => {
    const result = db.getByCodepoint(65);
    expect(result).toEqual({
      codepoint: 65,
      char: "A",
      name: "LATIN CAPITAL LETTER A",
      category: "Lu",
      script: "Latin",
      block: "Basic Latin",
      combiningClass: "Not_Reordered",
    });
  });

  it("returns null for surrogate codepoints", () => {
    expect(db.getByCodepoint(0xd800)).toBeNull();
  });

  it("returns data for a CJK ideograph", () => {
    const result = db.getByCodepoint(0x4e00);
    expect(result).not.toBeNull();
    expect(result!.block).toBe("CJK Unified Ideographs");
    expect(result!.script).toBe("Han");
  });

  it("returns data for DIGIT ZERO", () => {
    const result = db.getByCodepoint(0x30);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("DIGIT ZERO");
    expect(result!.category).toBe("Nd");
  });
});

describe("getByChar", () => {
  it("looks up by character", () => {
    const result = db.getByChar("Z");
    expect(result).not.toBeNull();
    expect(result!.codepoint).toBe(90);
    expect(result!.name).toBe("LATIN CAPITAL LETTER Z");
  });

  it("returns null for empty string", () => {
    expect(db.getByChar("")).toBeNull();
  });
});

describe("findByCategory", () => {
  it("finds uppercase letters", () => {
    const results = db.findByCategory("Lu");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.category === "Lu")).toBe(true);
    expect(results.find((r) => r.char === "A")).toBeDefined();
  });
});

describe("findByScript", () => {
  it("finds Latin characters", () => {
    const results = db.findByScript("Latin");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.script === "Latin")).toBe(true);
  });
});

describe("findByBlock", () => {
  it("finds Basic Latin block", () => {
    const results = db.findByBlock("Basic Latin");
    expect(results.length).toBe(128);
    expect(results[0].codepoint).toBe(0);
    expect(results[results.length - 1].codepoint).toBe(127);
  });
});

describe("searchByName", () => {
  it("finds characters matching a pattern", () => {
    const results = db.searchByName("SMILE");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.name?.includes("SMILE"))).toBe(true);
  });

  it("is case-insensitive via LIKE", () => {
    const upper = db.searchByName("LATIN CAPITAL");
    const lower = db.searchByName("latin capital");
    expect(upper.length).toBe(lower.length);
  });
});

describe("listBlocks", () => {
  it("returns distinct block names", () => {
    const blocks = db.listBlocks();
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks).toContain("Basic Latin");
    expect(blocks).toContain("CJK Unified Ideographs");
    // Should be sorted
    const sorted = [...blocks].sort();
    expect(blocks).toEqual(sorted);
  });
});

describe("listScripts", () => {
  it("returns distinct script names", () => {
    const scripts = db.listScripts();
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts).toContain("Latin");
    expect(scripts).toContain("Han");
  });
});

describe("listCategories", () => {
  it("returns distinct category codes", () => {
    const categories = db.listCategories();
    expect(categories.length).toBeGreaterThan(0);
    expect(categories).toContain("Lu");
    expect(categories).toContain("Ll");
    expect(categories).toContain("Nd");
  });
});

describe("countByBlock", () => {
  it("returns block counts sorted descending", () => {
    const counts = db.countByBlock();
    expect(counts.length).toBeGreaterThan(0);
    expect(counts[0].count).toBeGreaterThanOrEqual(counts[counts.length - 1].count);
    const basicLatin = counts.find((c) => c.block === "Basic Latin");
    expect(basicLatin).toBeDefined();
    expect(basicLatin!.count).toBe(128);
  });
});

describe("countByScript", () => {
  it("returns script counts sorted descending", () => {
    const counts = db.countByScript();
    expect(counts.length).toBeGreaterThan(0);
    expect(counts[0].count).toBeGreaterThanOrEqual(counts[counts.length - 1].count);
    const han = counts.find((c) => c.script === "Han");
    expect(han).toBeDefined();
    expect(han!.count).toBeGreaterThan(0);
  });
});

describe("countByCategory", () => {
  it("returns category counts sorted descending", () => {
    const counts = db.countByCategory();
    expect(counts.length).toBeGreaterThan(0);
    expect(counts[0].count).toBeGreaterThanOrEqual(counts[counts.length - 1].count);
    const lu = counts.find((c) => c.category === "Lu");
    expect(lu).toBeDefined();
    expect(lu!.count).toBeGreaterThan(0);
  });
});
