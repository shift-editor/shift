import { describe, expect, it } from "vitest";
import { glyphSearchMatcher, NO_SEARCH, type GlyphSearch } from "./glyphSearch";

const glyphs = [
  { name: "A", displayName: "A", unicode: 0x41 },
  { name: "a", displayName: "a", unicode: 0x61 },
  { name: "aacute", displayName: "aacute", unicode: 0xe1 },
  { name: "a.sc", displayName: "a.sc", unicode: null },
  { name: "uni0E01", displayName: "koKai-thai", unicode: 0x0e01 },
];
function found(search: Partial<GlyphSearch>): string[] {
  const matcher = glyphSearchMatcher({ ...NO_SEARCH, ...search });
  if (matcher.kind === "invalid") throw new Error(matcher.problem);
  return glyphs.filter(matcher.matches).map((glyph) => glyph.name);
}

describe("searching glyphs in the canvas's Glyphs tab", () => {
  it("matches every glyph with no text", () => {
    expect(found({})).toHaveLength(glyphs.length);
  });

  it("finds text anywhere in a name or display name, whatever its case", () => {
    expect(found({ text: "ACU" })).toEqual(["aacute"]);
    expect(found({ text: "kai" })).toEqual(["uni0E01"]);
  });

  it("finds a glyph by its character", () => {
    expect(found({ text: "á" })).toEqual(["aacute"]);
  });

  it("keeps to the typed case with Aa on", () => {
    expect(found({ text: "A", caseSensitive: true })).toEqual(["A"]);
    expect(found({ text: "a", caseSensitive: true })).toEqual(["a", "aacute", "a.sc", "uni0E01"]);
  });

  it("reads the text as a regular expression with .* on", () => {
    expect(found({ text: "^a(\\.|$)", regex: true, caseSensitive: true })).toEqual(["a", "a.sc"]);
    expect(found({ text: "^a$", regex: true })).toEqual(["A", "a"]);
  });

  it("says why text is not a regular expression instead of matching nothing", () => {
    expect(glyphSearchMatcher({ text: "a(", regex: true, caseSensitive: false })).toMatchObject({
      kind: "invalid",
    });
  });
});
