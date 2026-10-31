import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { GlyphId, GlyphName, KerningGroupId, SourceId } from "@shift/types";
import { kerningRule, type Font } from "@shift/editor/model";
import { createWorkspaceStack, type WorkspaceStack } from "@/testing/workspaceStack";

const MUTATOR_SANS = resolve(
  process.cwd(),
  "../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
);

// T then A kerns through A's second-position group @MMK_R_A at LightCondensed;
// the sparse sources ("Source 5", "Source 6") author no kerning.
describe("the font's kerning answers pair queries", () => {
  let stack: WorkspaceStack;
  let font: Font;
  const glyph = (name: string): GlyphId => font.recordForName(name as GlyphName)!.id;
  const source = (name: string): SourceId => font.sourceNamed(name)!.id;
  const group = (position: "first" | "second", name: string): KerningGroupId =>
    font.kerning.groups.named(position, name)!.id;

  beforeEach(async () => {
    stack = createWorkspaceStack();
    await stack.openWorkspace(MUTATOR_SANS);
    font = stack.font;
  });

  afterEach(() => stack.dispose());

  it("lists the pairs naming a glyph directly or through its group at that side", () => {
    const lightCondensed = source("LightCondensed");
    const pairsNamingA = font.kerning.pairsNaming(lightCondensed, glyph("A"));
    const groupA = group("second", "@MMK_R_A");

    expect(pairsNamingA).toContainEqual(
      expect.objectContaining({ first: glyph("T"), second: groupA }),
    );
    expect(
      pairsNamingA.every(
        ({ first, second }) =>
          first === glyph("A") ||
          first === group("first", "@MMK_L_A") ||
          second === glyph("A") ||
          second === groupA,
      ),
    ).toBe(true);
    expect(font.kerning.pairsNaming(source("Source 5"), glyph("A"))).toEqual([]);
  });

  it("names a pair's rule from its sides", () => {
    const groupA = group("second", "@MMK_R_A");
    const groupL = group("first", "@MMK_L_A");

    expect(kerningRule({ first: glyph("T"), second: glyph("A") })).toBe("glyph");
    expect(kerningRule({ first: glyph("T"), second: groupA })).toBe("exception");
    expect(kerningRule({ first: groupL, second: glyph("T") })).toBe("exception");
    expect(kerningRule({ first: groupL, second: groupA })).toBe("group");
  });

  it("says a missing pair kerns zero where the source kerns, and interpolates elsewhere", () => {
    expect(font.missingPairOrigin(source("LightCondensed"))).toBe("unkerned");
    expect(font.missingPairOrigin(source("Source 5"))).toBe("interpolated");
  });

  it("names a kerning side by its group or glyph name", () => {
    expect(font.kerningSideName(group("second", "@MMK_R_A"))).toBe("@MMK_R_A");
    expect(font.kerningSideName(glyph("T"))).toBe("T");
    expect(font.kerningSideName("glyph_gone" as GlyphId)).toBeNull();
  });
});
