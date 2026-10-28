import { describe, expect, it } from "vitest";
import { alphabetical } from "@shift/types";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

const MASTERS = ["LightCondensed", "BoldCondensed", "LightWide", "BoldWide"];

// T then A kerns through T (a glyph) and A's second-position group at every
// master: LightCondensed -75, BoldCondensed -65, LightWide -215, BoldWide -150.
const editor = useTestEditor({ file: FONTS.mutatorSans, glyph: "A" });

/** T–A's kerning at one master, as shown now. */
function kernTA(source: string): number {
  return editor.kerningAt(source, "T", "A").amount;
}

function ruleTA(source: string): string {
  return editor.kerningAt(source, "T", "A").rule;
}

describe("kerning edits", () => {
  it("shows an edit at once, keeps it after the echo, and undoes it", async () => {
    expect(ruleTA("LightCondensed")).toBe("exception");
    expect(kernTA("LightCondensed")).toBe(-75);

    editor.setKerning("LightCondensed", "T", "A", -90);
    expect(kernTA("LightCondensed")).toBe(-90);
    await editor.settle();
    expect(kernTA("LightCondensed")).toBe(-90);
    expect(kernTA("BoldWide")).toBe(-150);

    await editor.undo();
    expect(kernTA("LightCondensed")).toBe(-75);
  });

  it("removes a pair at a master, which then kerns 0 there while other masters keep theirs", async () => {
    editor.setKerning("LightCondensed", "T", "A", null);
    await editor.settle();

    expect(ruleTA("LightCondensed")).toBe("none");
    expect(kernTA("LightCondensed")).toBe(0);
    expect(kernTA("BoldWide")).toBe(-150);
  });

  it("interpolates a master whose last pair is removed, as the compiled font does", async () => {
    editor.setKerning("BoldWide", "T", "A", null);
    // The engine's basis drops BoldWide in the same frame, before the workspace persists it.
    expect(kernTA("BoldWide")).toBe(-205);

    await editor.settle();
    expect(kernTA("BoldWide")).toBe(-205);
  });

  it("removes an exception at a master, falling back to its group pair there", async () => {
    expect(await editor.setKerningException("BoldWide", "T", "A", "second", true)).toBe(true);
    editor.setKerning("BoldWide", "T", "A", -300);
    expect(kernTA("BoldWide")).toBe(-300);
    expect(ruleTA("BoldWide")).toBe("glyph");

    editor.setKerning("BoldWide", "T", "A", null);

    expect(kernTA("BoldWide")).toBe(-150);
  });

  it("previews an open edit and restores the value when it is discarded", () => {
    editor.previewKerning("LightCondensed", "T", "A", -100);
    expect(kernTA("LightCondensed")).toBe(-100);

    editor.cancelGesture();
    expect(kernTA("LightCondensed")).toBe(-75);
  });

  it("never loses a step when edits are made faster than the workspace echoes them", async () => {
    const nudge = () =>
      editor.setKerning("LightCondensed", "T", "A", kernTA("LightCondensed") - 10);

    nudge();
    nudge();
    nudge();
    expect(kernTA("LightCondensed")).toBe(-105);

    await editor.settle();
    expect(kernTA("LightCondensed")).toBe(-105);
  });

  it("refuses an edit the engine rejects and keeps the kerning", async () => {
    expect(() => editor.setKerning("LightCondensed", "T", "A", Number.NaN)).toThrow("not finite");
    await editor.settle();

    expect(kernTA("LightCondensed")).toBe(-75);
  });

  it("makes a side an exception at the edited source only, then returns it to the group", async () => {
    const before = MASTERS.map(kernTA);

    await editor.setKerningException("LightCondensed", "T", "A", "second", true);
    expect(ruleTA("LightCondensed")).toBe("glyph");
    expect(kernTA("LightCondensed")).toBe(-75);
    expect(ruleTA("BoldWide")).toBe("exception");
    expect(MASTERS.map(kernTA)).toEqual(before);

    editor.setKerning("LightCondensed", "T", "A", -40);
    await editor.setKerningException("LightCondensed", "T", "A", "second", false);

    expect(ruleTA("LightCondensed")).toBe("exception");
    expect(MASTERS.map(kernTA)).toEqual(before);
  });

  it("offers no lock for a glyph without a group on that side", async () => {
    expect(await editor.setKerningException("LightCondensed", "T", "A", "first", true)).toBe(false);
    expect(editor.kerningGroupOf("first", "T")).toBeNull();
  });
});

describe("kerning group edits", () => {
  const groupHolding = (position: "first" | "second", glyph: string) =>
    editor.kerningGroupOf(position, glyph);

  it("creates a group holding a glyph as one undo step", async () => {
    await editor.createKerningGroup("first", "Bars", ["T"]);

    expect(groupHolding("first", "T")?.name).toBe("Bars");
    await editor.undo();
    expect(groupHolding("first", "T")).toBeNull();
    expect(editor.kerningGroups("first").map(({ name }) => name)).not.toContain("Bars");
  });

  it("takes several glyphs out of their group as one undo step", async () => {
    const group = groupHolding("second", "A")!;
    const members = group.members.map(({ name }) => name!);
    const removed = members.slice(0, 2);

    await editor.moveToKerningGroup("second", removed, null);

    expect(editor.kerningGroup("second", group.name)?.members).toEqual(
      group.members.filter(({ name }) => !removed.includes(name!)),
    );
    await editor.undo();
    expect(editor.kerningGroup("second", group.name)?.members).toEqual(group.members);
  });

  it("renames a group without changing any kern", async () => {
    const before = kernTA("BoldWide");
    const group = groupHolding("second", "A")!;

    await editor.renameKerningGroup("second", group.name, "Apex");

    expect(groupHolding("second", "A")).toEqual({ ...group, name: "Apex" });
    expect(kernTA("BoldWide")).toBe(before);
  });

  it("lists each position's groups in name order", async () => {
    await editor.createKerningGroup("first", "zz-last", ["T"]);
    await editor.createKerningGroup("first", "aa-first", ["A"]);

    const firstNames = editor.kerningGroups("first").map(({ name }) => name);
    expect(firstNames.indexOf("aa-first")).toBeLessThan(firstNames.indexOf("zz-last"));
    expect(firstNames).toEqual(firstNames.toSorted(alphabetical));
    expect(editor.kerningGroups("first").every(({ position }) => position === "first")).toBe(true);
    expect(editor.kerningGroups("second").every(({ position }) => position === "second")).toBe(
      true,
    );
    expect(editor.kerningGroup("first", "zz-last")?.members.map(({ name }) => name)).toEqual(["T"]);
    expect(editor.kerningGroup("second", "zz-last")).toBeNull();
  });

  it("deletes a group, stopping its kerning until undo restores it", async () => {
    const group = groupHolding("second", "A")!;

    await editor.deleteKerningGroup("second", group.name);

    expect(editor.kerningGroup("second", group.name)).toBeNull();
    expect(kernTA("LightCondensed")).toBe(0);
    await editor.undo();
    expect(kernTA("LightCondensed")).toBe(-75);
  });
});
