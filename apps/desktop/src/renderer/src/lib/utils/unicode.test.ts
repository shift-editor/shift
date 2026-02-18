import { describe, expect, it } from "vitest";
import {
  fallbackGlyphNameForUnicode,
  glyphRefFromUnicode,
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

describe("glyphRefFromUnicode", () => {
  it("returns a full glyph ref", () => {
    const ref = glyphRefFromUnicode(0x41, {
      getExistingGlyphNameForUnicode: () => "A",
      getMappedGlyphName: () => null,
    });

    expect(ref).toEqual({ glyphName: "A", unicode: 0x41 });
  });
});
