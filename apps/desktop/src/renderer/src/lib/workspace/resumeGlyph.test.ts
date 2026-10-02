import { describe, expect, it } from "vitest";
import { asGlyphId, type GlyphName } from "@shift/types";
import { matchResumeGlyph } from "./resumeGlyph";

describe("matchResumeGlyph", () => {
  const glyphs = [
    { id: asGlyphId("g-a"), name: "A" as GlyphName, unicode: 65 },
    { id: asGlyphId("g-b"), name: "B" as GlyphName, unicode: 66 },
  ] as const;

  it("matches a unique glyph name", () => {
    expect(matchResumeGlyph(glyphs, { glyphName: "A", unicode: 65, glyphId: null })).toBe(
      asGlyphId("g-a"),
    );
  });

  it("falls back to unicode when the name is ambiguous", () => {
    const ambiguous = [
      { id: asGlyphId("g-1"), name: "A" as GlyphName, unicode: 65 },
      { id: asGlyphId("g-2"), name: "A" as GlyphName, unicode: 66 },
    ];
    expect(matchResumeGlyph(ambiguous, { glyphName: "A", unicode: 66, glyphId: null })).toBe(
      asGlyphId("g-2"),
    );
  });

  it("returns null for ambiguous matches", () => {
    const ambiguous = [
      { id: asGlyphId("g-1"), name: "A" as GlyphName, unicode: null },
      { id: asGlyphId("g-2"), name: "A" as GlyphName, unicode: null },
    ];
    expect(matchResumeGlyph(ambiguous, { glyphName: "A", unicode: null, glyphId: null })).toBeNull();
  });

  it("returns null for an empty catalog", () => {
    expect(matchResumeGlyph([], { glyphName: "A", unicode: 65, glyphId: null })).toBeNull();
  });
});
