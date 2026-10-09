import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { GlyphName } from "@shift/types";
import { isGroupSide, kerningValueEdit, type Font } from "@shift/editor/model";
import { createWorkspaceStack } from "@/testing/workspaceStack";

const MUTATOR_SANS = resolve(
  process.cwd(),
  "../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
);

// T then A kerns through T (a glyph) and A's second-position group at every
// master: LightCondensed -75, BoldCondensed -65, LightWide -215, BoldWide -150.
async function openMutatorSans() {
  const stack = createWorkspaceStack();
  await stack.openWorkspace(MUTATOR_SANS);
  const font = stack.font;
  const id = (name: string) => font.recordForName(name as GlyphName)!.id;
  const source = (name: string) => font.sources.find((candidate) => candidate.name === name)!.id;
  return { stack, font, t: id("T"), a: id("A"), lightCondensed: source("LightCondensed") };
}

function kernAt(font: Font, sourceName: string, first: string, second: string): number {
  const sourceId = font.sources.find((candidate) => candidate.name === sourceName)!.id;
  const id = (name: string) => font.recordForName(name as GlyphName)!.id;
  return font.kerningBetween(id(first), id(second), font.defaultLocation(), sourceId);
}

describe("kerning edits", () => {
  it("shows an edit at once, keeps it after the echo, and undoes it", async () => {
    const { stack, font, t, a, lightCondensed } = await openMutatorSans();
    const pair = font.kerningCell.peek().editablePair(lightCondensed, t, a);
    expect(pair).toMatchObject({ first: t, amount: -75 });
    expect(isGroupSide(pair.second)).toBe(true);

    const edit = kerningValueEdit(lightCondensed, pair, -90);
    const committed = font.setKerningValues([edit], "Change kerning");
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(-90);
    await committed;
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(-90);
    expect(kernAt(font, "BoldWide", "T", "A")).toBe(-150);

    await stack.editCoordinator.undo();
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(-75);
  });

  it("previews a value without committing it", async () => {
    const { font, t, a, lightCondensed } = await openMutatorSans();
    const pair = font.kerningCell.peek().editablePair(lightCondensed, t, a);

    font.previewKerning([kerningValueEdit(lightCondensed, pair, -100)]);
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(-100);

    font.previewKerning([]);
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(-75);
  });

  it("makes a side an exception at the edited source only, then returns it to the group", async () => {
    const { font, t, a, lightCondensed } = await openMutatorSans();
    const masters = ["LightCondensed", "BoldCondensed", "LightWide", "BoldWide"];
    const before = masters.map((name) => kernAt(font, name, "T", "A"));
    const groupPair = font.kerningCell.peek().editablePair(lightCondensed, t, a);

    const lock = font.kerningCell
      .peek()
      .exceptionEdit(lightCondensed, t, a, groupPair, "second", true);
    await font.setKerningValues([lock!], "Make kerning exception");
    const exception = font.kerningCell.peek().editablePair(lightCondensed, t, a);
    expect(exception).toMatchObject({ second: a, amount: -75 });
    const boldWide = font.sources.find((s) => s.name === "BoldWide")!.id;
    expect(isGroupSide(font.kerningCell.peek().editablePair(boldWide, t, a).second)).toBe(true);
    expect(masters.map((name) => kernAt(font, name, "T", "A"))).toEqual(before);

    await font.setKerningValues(
      [kerningValueEdit(lightCondensed, exception, -40)],
      "Change kerning",
    );
    const unlock = font.kerningCell
      .peek()
      .exceptionEdit(
        lightCondensed,
        t,
        a,
        font.kerningCell.peek().editablePair(lightCondensed, t, a),
        "second",
        false,
      );
    await font.setKerningValues([unlock!], "Remove kerning exception");

    expect(font.kerningCell.peek().editablePair(lightCondensed, t, a)).toEqual(groupPair);
    expect(masters.map((name) => kernAt(font, name, "T", "A"))).toEqual(before);
  });

  it("offers no lock for a glyph without a group on that side", async () => {
    const { font, t, a, lightCondensed } = await openMutatorSans();
    const pair = font.kerningCell.peek().editablePair(lightCondensed, t, a);

    expect(
      font.kerningCell.peek().exceptionEdit(lightCondensed, t, a, pair, "first", true),
    ).toBeNull();
    expect(font.kerningCell.peek().groupOf("first", t)).toBeNull();
  });
});
