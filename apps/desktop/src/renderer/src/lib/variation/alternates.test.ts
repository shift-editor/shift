import { describe, expect, it } from "vitest";
import { FONTS, useTestEditor } from "@/testing/fontFixture";
import { GlyphAlternates } from "./GlyphAlternates";

// Solenoid: a Bleed axis (0–100, source Bled at 100). `dollar` draws
// `dollar.bled` from Bleed 70, then `dollar.heavy` from 80, which the first
// always beats. Both alternates are drawn at Regular and Bled.
const editor = useTestEditor({ file: FONTS.solenoid, glyph: "dollar" });

/** The open glyph's alternates, as the Designspace tab's Alternates section uses them. */
function alternates() {
  return new GlyphAlternates(editor.asEditor());
}

/** What the Alternates section lists, by glyph name; null when it is not shown. */
function rows() {
  const section = alternates().sectionCell.peek();
  if (!section) return null;

  return section.rows.map(({ glyphName, chips, inUse, neverUsed }) => ({
    glyph: glyphName,
    chips: chips.map(({ axis, valueText }) => `${axis.name} ${valueText}`),
    inUse,
    neverUsed,
  }));
}

/** The row of the alternate drawing `glyph`. */
function row(glyph: string) {
  const section = alternates().sectionCell.peek();
  // oxlint-disable-next-line shift/no-lookup-in-tests -- the section names rows by glyph; no selector reads them
  const found = section?.rows.find((candidate) => candidate.glyphName === glyph);
  if (!found) throw new Error(`no alternate draws ${glyph}`);
  return found;
}

function bleed() {
  const axis = alternates().chips.axisGroups[0]?.axes[0];
  if (!axis) throw new Error("no Bleed axis");
  return axis;
}

describe("the Alternates section", () => {
  it("lists the alternates in the order they are tried, with their chips", () => {
    expect(rows()).toEqual([
      { glyph: "dollar.bled", chips: ["Bleed ≥ 70"], inUse: false, neverUsed: null },
      {
        glyph: "dollar.heavy",
        chips: ["Bleed ≥ 80"],
        inUse: false,
        neverUsed: "Never used: dollar.bled above always wins first. Drag it below.",
      },
    ]);
  });

  it("shows for a glyph without alternates, listing none", async () => {
    await editor.openGlyph("H");

    expect(rows()).toEqual([]);
  });

  it("marks the alternate the canvas draws here", () => {
    editor.setLocation({ BLED: 90 });

    expect(rows()?.map(({ glyph, inUse }) => [glyph, inUse])).toEqual([
      ["dollar.bled", true],
      ["dollar.heavy", false],
    ]);
  });

  it("reorders, so the narrower alternate is tried first and used", async () => {
    await alternates().move(row("dollar.heavy").id, 0);
    editor.setLocation({ BLED: 90 });

    expect(rows()).toMatchObject([
      { glyph: "dollar.heavy", inUse: true, neverUsed: null },
      { glyph: "dollar.bled", inUse: false, neverUsed: null },
    ]);
  });

  it("adds an alternate on a glyph the font has, and deletes it", async () => {
    const reading = alternates().chips.read(bleed(), "<=20");
    if (reading.kind !== "range") throw new Error(reading.message);
    await alternates().add(editor.glyphNamed("dot")!.id, reading.range);

    expect(rows()?.at(-1)).toMatchObject({ glyph: "dot", chips: ["Bleed ≤ 20"] });

    await alternates().remove(row("dot").id);
    expect(rows()?.map(({ glyph }) => glyph)).toEqual(["dollar.bled", "dollar.heavy"]);
  });

  it("creates dollar.alt for a new alternate", async () => {
    const reading = alternates().chips.read(bleed(), "10-20");
    if (reading.kind !== "range") throw new Error(reading.message);
    const name = alternates().newGlyphName()!;
    await alternates().createAndAdd(name, reading.range);

    expect(name).toBe("dollar.alt");
    expect(editor.glyphNamed("dollar.alt")).not.toBeNull();
    expect(rows()?.at(-1)).toMatchObject({ glyph: "dollar.alt", chips: ["Bleed 10–20"] });
  });
});

describe("condition chips", () => {
  it("read every form of the grammar, in user units", () => {
    const chips = alternates().chips;
    const read = (text: string) => {
      const reading = chips.read(bleed(), text);
      return reading.kind === "range"
        ? [reading.range.min ?? null, reading.range.max ?? null]
        : reading;
    };

    for (const text of ["70", ">=70", "≥70", "70+"]) expect(read(text)).toEqual([70, null]);
    for (const text of ["<=50", "≤50"]) expect(read(text)).toEqual([null, 50]);
    for (const text of ["40-60", "40–60"]) expect(read(text)).toEqual([40, 60]);
  });

  it("say why text can't be read, and commit nothing", () => {
    const chips = alternates().chips;

    expect(chips.read(bleed(), "150")).toEqual({
      kind: "problem",
      message: "Bleed only goes to 100.",
    });
    expect(chips.read(bleed(), "heavy")).toMatchObject({ kind: "problem" });
    expect(chips.read(bleed(), "60-40")).toMatchObject({ kind: "problem" });
  });

  it("start a new chip from where the canvas draws", () => {
    editor.setLocation({ BLED: 35 });

    expect(alternates().chips.prefill(bleed())).toBe("≥ 35");
  });

  it("edit a range in place, end to end", async () => {
    const chips = alternates().chips;
    const reading = chips.read(bleed(), "≤ 90");
    if (reading.kind !== "range") throw new Error(reading.message);
    await alternates().setRange(row("dollar.heavy").id, null, reading.range);

    expect(row("dollar.heavy").chips.map(({ valueText }) => valueText)).toEqual(["≥ 80", "≤ 90"]);

    await alternates().removeRange(row("dollar.heavy").id, 1);
    expect(row("dollar.heavy").chips.map(({ valueText }) => valueText)).toEqual(["≥ 80"]);
  });
});

describe("the canvas inside an alternate's region", () => {
  it("draws the alternate there, and the glyph again outside it", async () => {
    editor.setLocation({ BLED: 100 });
    expect(await editor.drawnGlyph()).toMatchObject({
      glyph: "dollar.bled",
      bounds: { min: { x: 30 }, max: { x: 470 } },
    });

    editor.setLocation({ BLED: 0 });
    expect(await editor.drawnGlyph()).toMatchObject({ glyph: "dollar" });
  });

  it("edits the alternate, leaving the glyph as it was", async () => {
    editor.setLocation({ BLED: 100 });
    editor.selectTool("select");
    editor.selectAll();
    await editor.pressKey("ArrowRight", { shiftKey: true });

    expect(await editor.drawnGlyph()).toMatchObject({
      glyph: "dollar.bled",
      bounds: { min: { x: 40 } },
    });
    expect(await editor.drawnGlyph("dollar")).toMatchObject({ bounds: { min: { x: 180 } } });
  });

  it("says which glyph it draws for the one opened", () => {
    editor.setLocation({ BLED: 75 });

    expect(editor.editedGlyph()).toEqual({ glyph: "dollar", drawnAs: "dollar.bled" });
  });
});
