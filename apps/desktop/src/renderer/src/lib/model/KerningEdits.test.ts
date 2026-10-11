import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { GlyphId, GlyphName } from "@shift/types";
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

    font.setKerningValues([kerningValueEdit(lightCondensed, pair, -90)], "Change kerning");
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(-90);
    await stack.editCoordinator.settled();
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(-90);
    expect(kernAt(font, "BoldWide", "T", "A")).toBe(-150);

    await stack.editCoordinator.undo();
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(-75);
  });

  it("removes a pair at a master, which then kerns 0 there while other masters keep theirs", async () => {
    const { stack, font, t, a, lightCondensed } = await openMutatorSans();
    const applied = font.kerningCell.peek().resolve(lightCondensed, t, a)!;

    font.setKerningValues([kerningValueEdit(lightCondensed, applied)], "Remove kerning");
    await stack.editCoordinator.settled();

    expect(font.kerningCell.peek().resolve(lightCondensed, t, a)).toBeNull();
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(0);
    expect(kernAt(font, "BoldWide", "T", "A")).toBe(-150);
  });

  it("interpolates a master whose last pair is removed, as the compiled font does", async () => {
    const { stack, font, t, a } = await openMutatorSans();
    const boldWide = font.sources.find((source) => source.name === "BoldWide")!.id;
    const applied = font.kerningCell.peek().resolve(boldWide, t, a)!;

    font.setKerningValues([kerningValueEdit(boldWide, applied)], "Remove kerning");
    // The interpolation basis drops BoldWide only once Rust echoes the change.
    await stack.editCoordinator.settled();

    expect(kernAt(font, "BoldWide", "T", "A")).toBe(-205);
  });

  it("removes an exception at a master, falling back to its group pair there", async () => {
    const { font, t, a } = await openMutatorSans();
    const boldWide = font.sources.find((source) => source.name === "BoldWide")!.id;
    const exception = { first: t, second: a };
    font.setKerningValues([kerningValueEdit(boldWide, exception, -300)], "Kern");
    expect(kernAt(font, "BoldWide", "T", "A")).toBe(-300);

    font.setKerningValues([kerningValueEdit(boldWide, exception)], "Remove kerning");

    expect(kernAt(font, "BoldWide", "T", "A")).toBe(-150);
  });

  it("previews an open edit and restores the value when it is discarded", async () => {
    const { font, t, a, lightCondensed } = await openMutatorSans();
    const pair = font.kerningCell.peek().editablePair(lightCondensed, t, a);

    const edit = font.beginKerningEdit();
    edit.preview([kerningValueEdit(lightCondensed, pair, -100)]);
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(-100);

    edit.discard();
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(-75);
  });

  it("never loses a step when edits are made faster than the workspace echoes them", async () => {
    const { stack, font, t, a, lightCondensed } = await openMutatorSans();
    const nudge = () => {
      const pair = font.kerningCell.peek().editablePair(lightCondensed, t, a);
      font.setKerningValues([kerningValueEdit(lightCondensed, pair, pair.amount - 10)], "Nudge");
    };

    nudge();
    nudge();
    nudge();
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(-105);

    await stack.editCoordinator.settled();
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(-105);
  });

  it("shows an undo queued behind a pending edit once it lands", async () => {
    const { stack, font, t, a, lightCondensed } = await openMutatorSans();
    const pair = font.kerningCell.peek().editablePair(lightCondensed, t, a);

    font.setKerningValues([kerningValueEdit(lightCondensed, pair, -90)], "Change kerning");
    const undone = stack.editCoordinator.undo();
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(-90);

    await undone;
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(-75);
  });

  it("drops an edit the workspace rejects", async () => {
    const { stack, font, t, a, lightCondensed } = await openMutatorSans();
    const pair = font.kerningCell.peek().editablePair(lightCondensed, t, a);

    font.setKerningValues([kerningValueEdit(lightCondensed, pair, Number.NaN)], "Bad kerning");
    await stack.editCoordinator.settled();

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

describe("kerning group edits", () => {
  const groupOf = (font: Font, position: "first" | "second", glyphId: GlyphId) => {
    const groupId = font.kerningCell.peek().groupOf(position, glyphId);
    return groupId ? font.kerningCell.peek().groups.group(groupId) : null;
  };

  it("creates a group holding a glyph as one undo step", async () => {
    const { stack, font, t } = await openMutatorSans();

    const groupId = await font.createKerningGroup("first", "Bars", [t]);

    expect(font.kerningCell.peek().groupOf("first", t)).toBe(groupId);
    expect(groupOf(font, "first", t)?.name).toBe("Bars");
    await stack.editCoordinator.undo();
    expect(font.kerningCell.peek().groupOf("first", t)).toBeNull();
    expect(font.kerningCell.peek().groups.group(groupId)).toBeNull();
  });

  it("takes several glyphs out of their group as one undo step", async () => {
    const { stack, font, a } = await openMutatorSans();
    const group = groupOf(font, "second", a)!;
    const removed = group.glyphIds.slice(0, 2);

    await font.assignKerningGroup("second", removed, null);

    expect(font.kerningCell.peek().groups.group(group.id)?.glyphIds).toEqual(
      group.glyphIds.filter((member) => !removed.includes(member)),
    );
    await stack.editCoordinator.undo();
    expect(font.kerningCell.peek().groups.group(group.id)?.glyphIds).toEqual(group.glyphIds);
  });

  it("renames a group without changing any kern", async () => {
    const { font, a } = await openMutatorSans();
    const before = kernAt(font, "BoldWide", "T", "A");
    const group = groupOf(font, "second", a)!;

    await font.renameKerningGroup(group.id, "Apex");

    expect(groupOf(font, "second", a)).toMatchObject({ id: group.id, name: "Apex" });
    expect(kernAt(font, "BoldWide", "T", "A")).toBe(before);
  });

  it("deletes a group, stopping its kerning until undo restores it", async () => {
    const { stack, font, a } = await openMutatorSans();
    const group = groupOf(font, "second", a)!;

    await font.deleteKerningGroup(group.id);

    expect(font.kerningCell.peek().groups.group(group.id)).toBeNull();
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(0);
    await stack.editCoordinator.undo();
    expect(kernAt(font, "LightCondensed", "T", "A")).toBe(-75);
  });
});
