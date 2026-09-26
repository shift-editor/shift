import { describe, expect, it } from "vitest";
import type { GlyphName } from "@shift/types";
import type { GlyphSet } from "@/types/glyphSet";
import { getGlyphInfo } from "@/workspace/glyphInfo";
import { parseGlyphList, selectedGlyphNames } from "./glyphSetSelection";

describe("glyph list preparation", () => {
  it("resolves pasted names, slash names, Unicode, and unencoded names", () => {
    const result = parseGlyphList("/A B U+00C1 .notdef /A", getGlyphInfo());

    expect(result).toEqual({
      glyphNames: ["A", "B", "Aacute", ".notdef"],
      errors: [],
    });
  });

  it("reports recipes and invalid Unicode without silently adding partial glyphs", () => {
    const result = parseGlyphList("U+D800 U+110000 A+acutecomb=Aacute /", getGlyphInfo());

    expect(result.glyphNames).toEqual([]);
    expect(result.errors).toHaveLength(4);
  });

  it("combines overlapping sets, picked glyphs, and pasted names once", () => {
    const sets: GlyphSet[] = [
      { id: "latin", name: "Latin", scope: "builtIn", glyphNames: ["A", "B"] as GlyphName[] },
      { id: "more", name: "More", scope: "user", glyphNames: ["B", "C"] as GlyphName[] },
    ];

    expect(
      selectedGlyphNames(sets, new Set(["latin", "more"]), ["A" as GlyphName], ["D" as GlyphName]),
    ).toEqual(["A", "B", "C", "D"]);
  });
});
