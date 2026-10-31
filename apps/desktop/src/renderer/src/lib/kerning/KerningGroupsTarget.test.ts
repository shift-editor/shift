import { describe, expect, it } from "vitest";
import { asGlyphId } from "@shift/types";
import { KerningGroupsTarget } from "./KerningGroupsTarget";

const t = asGlyphId("glyph-T");
const a = asGlyphId("glyph-A");

describe("KerningGroupsTarget", () => {
  it("opens a pair's tabs on each side's glyph, set against the other", () => {
    const pair = KerningGroupsTarget.pair(t, a);

    expect(pair.glyphAt("first")).toBe(t);
    expect(pair.glyphAt("second")).toBe(a);
    expect(pair.partnerAt("first")).toBe(a);
    expect(pair.partnerAt("second")).toBe(t);
  });

  it("opens both of a glyph's tabs on that glyph, with nothing to kern against", () => {
    const glyph = KerningGroupsTarget.glyph(t);

    expect(glyph.glyphAt("first")).toBe(t);
    expect(glyph.glyphAt("second")).toBe(t);
    expect(glyph.partnerAt("first")).toBeNull();
  });

  it("keys equal targets alike and different targets apart", () => {
    expect(KerningGroupsTarget.pair(t, a).key).toBe(KerningGroupsTarget.pair(t, a).key);
    expect(KerningGroupsTarget.pair(t, a).key).not.toBe(KerningGroupsTarget.pair(a, t).key);
    expect(KerningGroupsTarget.glyph(t).key).not.toBe(KerningGroupsTarget.pair(t, t).key);
  });
});
