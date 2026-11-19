import { describe, expect, it } from "vitest";
import { FONTS, useTestEditor } from "@/testing/fontFixture";
import { GlyphSwaps } from "./GlyphSwaps";
import { boundsOnAxis, chipDisplayText } from "./ConditionChipSpace";
import { GlyphDesignspace } from "./GlyphDesignspace";

// Solenoid: a Bleed axis (0–100, source Bled at 100). `dollar` draws
// `dollar.bled` from Bleed 70, then `dollar.heavy` from 80, which the first
// always beats. Both swaps are drawn at Regular and Bled.
const editor = useTestEditor({ file: FONTS.solenoid, glyph: "dollar" });

/** The open glyph's swaps, as the Designspace tab's Swaps section uses them. */
function swaps() {
  return new GlyphSwaps(editor.asEditor());
}

/** What the Swaps section lists, by glyph name; null when it is not shown. */
function rows() {
  const section = swaps().sectionCell.peek();
  if (!section) return null;

  return section.rows.map(({ glyphName, chips, inUse, neverUsed }) => ({
    glyph: glyphName,
    chips: chips.map(({ axis, valueText }) => `${axis.name} ${valueText}`),
    inUse,
    neverUsed,
  }));
}

/** The row of the swap drawing `glyph`. */
function row(glyph: string) {
  const section = swaps().sectionCell.peek();
  // oxlint-disable-next-line shift/no-lookup-in-tests -- the section names rows by glyph; no selector reads them
  const found = section?.rows.find((candidate) => candidate.glyphName === glyph);
  if (!found) throw new Error(`no swap draws ${glyph}`);
  return found;
}

function bleed() {
  const axis = swaps().chips.axisGroups[0]?.axes[0];
  if (!axis) throw new Error("no Bleed axis");
  return axis;
}

describe("the Swaps section", () => {
  it("lists the swaps in the order they are tried, with their chips", () => {
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

  it("shows for a glyph without swaps, listing none", async () => {
    await editor.openGlyph("H");

    expect(rows()).toEqual([]);
  });

  it("marks the swap the canvas draws here", () => {
    editor.setLocation({ BLED: 90 });

    expect(rows()?.map(({ glyph, inUse }) => [glyph, inUse])).toEqual([
      ["dollar.bled", true],
      ["dollar.heavy", false],
    ]);
  });

  it("reorders, so the narrower swap is tried first and used", async () => {
    await swaps().move(row("dollar.heavy").id, 0);
    editor.setLocation({ BLED: 90 });

    expect(rows()).toMatchObject([
      { glyph: "dollar.heavy", inUse: true, neverUsed: null },
      { glyph: "dollar.bled", inUse: false, neverUsed: null },
    ]);
  });

  it("adds a swap on a glyph the font has, and deletes it", async () => {
    const reading = swaps().chips.read(bleed(), "<=20");
    if (reading.kind !== "range") throw new Error(reading.message);
    await swaps().add(editor.glyphNamed("dot")!.id, reading.range);

    expect(rows()?.at(-1)).toMatchObject({ glyph: "dot", chips: ["Bleed ≤ 20"] });

    await swaps().remove(row("dot").id);
    expect(rows()?.map(({ glyph }) => glyph)).toEqual(["dollar.bled", "dollar.heavy"]);
  });

  it("creates dollar.alt for a new swap", async () => {
    const reading = swaps().chips.read(bleed(), "10-20");
    if (reading.kind !== "range") throw new Error(reading.message);
    const name = swaps().newGlyphName()!;
    await swaps().createAndAdd(name, reading.range);

    expect(name).toBe("dollar.alt");
    expect(editor.glyphNamed("dollar.alt")).not.toBeNull();
    expect(rows()?.at(-1)).toMatchObject({ glyph: "dollar.alt", chips: ["Bleed 10–20"] });
  });
});

describe("condition chips", () => {
  it("read every form of the grammar, in user units", () => {
    const chips = swaps().chips;
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
    const chips = swaps().chips;

    expect(chips.read(bleed(), "150")).toEqual({
      kind: "problem",
      message: "Bleed only goes to 100.",
    });
    expect(chips.read(bleed(), "heavy")).toMatchObject({ kind: "problem" });
    expect(chips.read(bleed(), "60-40")).toMatchObject({ kind: "problem" });
  });

  it("start a new chip from where the canvas draws", () => {
    editor.setLocation({ BLED: 35 });

    expect(swaps().chips.prefill(bleed())).toBe("≥ 35");
  });

  it("edit a range in place, end to end", async () => {
    const chips = swaps().chips;
    const reading = chips.read(bleed(), "≤ 90");
    if (reading.kind !== "range") throw new Error(reading.message);
    await swaps().setRange(row("dollar.heavy").id, null, reading.range);

    expect(row("dollar.heavy").chips.map(({ valueText }) => valueText)).toEqual(["≥ 80", "≤ 90"]);

    await swaps().removeRange(row("dollar.heavy").id, 1);
    expect(row("dollar.heavy").chips.map(({ valueText }) => valueText)).toEqual(["≥ 80"]);
  });
});

describe("a chip's equation", () => {
  const ends = (bounds: { min: string; max: string }) => {
    const reading = swaps().chips.rangeOf(bleed(), bounds);
    return reading.kind === "range"
      ? [reading.range.min ?? null, reading.range.max ?? null]
      : reading;
  };

  it("makes a range from its bounds, an empty field leaving that side open", () => {
    expect(ends({ min: "70", max: "" })).toEqual([70, null]);
    expect(ends({ min: "", max: "80" })).toEqual([null, 80]);
    expect(ends({ min: "40", max: "60" })).toEqual([40, 60]);
    expect(ends({ min: "", max: "" })).toMatchObject({ kind: "problem" });
  });

  it("refuses a minimum above the maximum", () => {
    expect(ends({ min: "60", max: "40" })).toEqual({
      kind: "problem",
      message: "The range 60 to 40 runs downwards.",
    });
  });

  it("fills both fields from a range pasted into either", () => {
    const chips = swaps().chips;
    const empty = { min: "", max: "" };

    expect(chips.boundsFromField(bleed(), empty, "min", "40-60")).toEqual({
      kind: "bounds",
      bounds: { min: "40", max: "60" },
    });
    expect(chips.boundsFromField(bleed(), empty, "max", ">=70")).toEqual({
      kind: "bounds",
      bounds: { min: "70", max: "" },
    });
    expect(chips.boundsFromField(bleed(), empty, "min", "<=80")).toMatchObject({
      bounds: { min: "", max: "80" },
    });
    expect(chips.boundsFromField(bleed(), { min: "", max: "90" }, "min", "12")).toMatchObject({
      bounds: { min: "12", max: "90" },
    });
  });

  it("keeps its bounds on another axis, inside that axis's range", async () => {
    await editor.openGlyph("H");
    const designspace = new GlyphDesignspace(editor.asEditor());
    await designspace.addAxis({ name: "Gap", minimum: 0, default: 0, maximum: 50 });
    const gap = designspace.axisTagged(designspace.glyph!.axes[0]!.tag)!;

    expect(boundsOnAxis({ min: "30", max: "80" }, gap)).toEqual({ min: "30", max: "50" });
    expect(boundsOnAxis({ min: "", max: "20" }, gap)).toEqual({ min: "", max: "20" });
  });
});

describe("a chip's shown value", () => {
  it("is rounded, and open on a side that reaches the axis's end", () => {
    const axis = bleed(); // 0 to 100

    expect(chipDisplayText("≥ 69.444", axis)).toBe("≥ 69.4");
    expect(chipDisplayText("16.84–50", axis)).toBe("16.8–50");
    expect(chipDisplayText("69.444–100", axis)).toBe("≥ 69.4");
    expect(chipDisplayText("0–80", axis)).toBe("≤ 80");
    expect(chipDisplayText("0–100", axis)).toBe("0–100");
  });

  it("is whole from 100 up, while editing starts from the exact value", async () => {
    const reading = swaps().chips.read(bleed(), "≥ 69.444");
    if (reading.kind !== "range") throw new Error(reading.message);
    await swaps().setRange(row("dollar.bled").id, 0, reading.range);

    expect(row("dollar.bled").chips[0]).toMatchObject({
      valueText: "≥ 69.444",
      displayText: "≥ 69.4",
    });
    expect(chipDisplayText("≥ 694.444", bleed())).toBe("≥ 694");
  });
});

describe("the canvas inside a swap's region", () => {
  it("draws the swap there, and the glyph again outside it", async () => {
    editor.setLocation({ BLED: 100 });
    expect(await editor.drawnGlyph()).toMatchObject({
      glyph: "dollar.bled",
      bounds: { min: { x: 30 }, max: { x: 470 } },
    });

    editor.setLocation({ BLED: 0 });
    expect(await editor.drawnGlyph()).toMatchObject({ glyph: "dollar" });
  });

  it("edits the swap, leaving the glyph as it was", async () => {
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
