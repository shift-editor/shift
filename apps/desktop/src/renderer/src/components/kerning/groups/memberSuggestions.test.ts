import { describe, expect, it } from "vitest";
import type { GlyphEntry, GlyphId, KerningGroupId } from "@shift/types";
import { memberCandidates, memberStem } from "./memberSuggestions";

const entry = (name: string, unicode?: number): GlyphEntry => ({
  id: `glyph_${name}` as GlyphId,
  name,
  unicodes: unicode === undefined ? [] : [unicode],
});

const T = entry("T", 0x54);
const Tss01 = entry("T.ss01");
const Tcaron = entry("Tcaron", 0x164);
const Tbar = entry("Tbar", 0x166);
const V = entry("V", 0x56);
const entries = [T, Tss01, Tcaron, Tbar, V];

describe("kerning group member suggestions", () => {
  it("takes the members' stem from the shortest name before any suffix", () => {
    expect(memberStem(["Tcaron", "T.ss01"])).toBe("T");
    expect(memberStem([])).toBeNull();
  });

  it("suggests glyphs named after the stem, ungrouped ones first", () => {
    const grouped = new Set<GlyphId>([Tcaron.id]);
    const groupOf = (glyph: GlyphEntry) =>
      grouped.has(glyph.id) ? ("kerningGroup_O" as KerningGroupId) : null;

    const candidates = memberCandidates(entries, [T.id], ["T"], "", groupOf);

    expect(candidates.map((glyph) => glyph.name)).toEqual(["T.ss01", "Tbar", "Tcaron"]);
  });

  it("searches outside the group by name or by character", () => {
    const none = () => null;

    expect(memberCandidates(entries, [T.id], ["T"], "car", none)).toEqual([Tcaron]);
    expect(memberCandidates(entries, [T.id], ["T"], "V", none)).toEqual([V]);
  });
});
