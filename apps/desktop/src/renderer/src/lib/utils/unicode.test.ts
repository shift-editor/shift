import { describe, expect, it } from "vitest";
import {
  cellFromCodepoint,
  fallbackGlyphNameForUnicode,
  resolveGlyphNameFromUnicode,
} from "./unicode";

describe("resolveGlyphNameFromUnicode", () => {
  it("prefers existing glyph names from the loaded font", () => {
    const name = resolveGlyphNameFromUnicode(0x41, {
      getExistingGlyphNameForUnicode: () => "A.custom",
      getMappedGlyphName: () => "A",
    });

    expect(name).toBe("A.custom");
  });

  it("uses mapped glyph-info names when no existing glyph name is present", () => {
    const name = resolveGlyphNameFromUnicode(0x2e, {
      getExistingGlyphNameForUnicode: () => null,
      getMappedGlyphName: () => "period",
    });

    expect(name).toBe("period");
  });

  it("falls back to uniXXXX for unknown codepoints", () => {
    const name = resolveGlyphNameFromUnicode(0x10fffd, {
      getExistingGlyphNameForUnicode: () => null,
      getMappedGlyphName: () => null,
    });

    expect(name).toBe(fallbackGlyphNameForUnicode(0x10fffd));
  });
});

describe("cellFromCodepoint", () => {
  it("returns a glyph cell with the resolved name and codepoint", () => {
    const cell = cellFromCodepoint(0x41, {
      getExistingGlyphNameForUnicode: () => "A",
      getMappedGlyphName: () => null,
    });

    expect(cell).toEqual({ kind: "glyph", glyphName: "A", codepoint: 0x41 });
  });
});
