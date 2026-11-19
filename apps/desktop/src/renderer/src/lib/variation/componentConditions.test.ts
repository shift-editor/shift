import { describe, expect, it } from "vitest";
import { FONTS, useTestEditor } from "@/testing/fontFixture";
import { ConditionChipSpace } from "./ConditionChipSpace";
import { ComponentConditions } from "./ComponentConditions";

// Solenoid's `colon` is three `dot`s 300 apart; the second and third draw
// up to Bleed 50, the first everywhere. Bled is the source at Bleed 100.
const editor = useTestEditor({ file: FONTS.solenoid, glyph: "colon" });

/** What the component section's chips show for the selection; null when it shows none. */
function shown() {
  const condition = new ComponentConditions(editor.asEditor()).selectedCell.peek();
  if (!condition) return null;

  return {
    chips: condition.chips.map(({ axis, valueText }) => `${axis.name} ${valueText}`),
    mixed: condition.mixed,
  };
}

/** Selects `colon`'s dots by position, counting from 1, by clicking their middles. */
async function selectDots(...positions: number[]) {
  const { components } = await editor.drawnGlyph();
  for (const [index, position] of positions.entries()) {
    const bounds = components[position - 1]!.bounds!;
    const middle = { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2 };
    await editor.clickAt(middle, index === 0 ? undefined : { shiftKey: true });
  }
}

function range(text: string) {
  const chips = new ConditionChipSpace(editor.asEditor(), null);
  const axis = chips.axisGroups[0]!.axes[0]!;
  const reading = chips.read(axis, text);
  if (reading.kind !== "range") throw new Error(reading.message);
  return reading.range;
}

describe("the component section's condition chips", () => {
  it("show the condition the selected components share", async () => {
    await selectDots(2, 3);

    expect(shown()).toEqual({ chips: ["Bleed ≤ 50"], mixed: false });
  });

  it("say Mixed when the selected components differ", async () => {
    await selectDots(1, 2);

    expect(shown()).toEqual({ chips: [], mixed: true });
  });

  it("give every selected component a new chip, in every source", async () => {
    await selectDots(1, 2);
    await new ComponentConditions(editor.asEditor()).setRange(null, range(">=10"));

    expect(shown()).toEqual({ chips: ["Bleed ≥ 10"], mixed: true });
    editor.setLocation({ BLED: 100 });
    await editor.editSources(["Bled"]);
    await selectDots(1);
    expect(shown()).toEqual({ chips: ["Bleed ≥ 10"], mixed: false });
  });

  it("remove a shared chip from each component", async () => {
    await selectDots(2, 3);
    await new ComponentConditions(editor.asEditor()).removeRange(range("<=50"));

    expect(shown()).toEqual({ chips: [], mixed: false });
    editor.setLocation({ BLED: 100 });
    expect((await editor.drawnGlyph()).components.map(({ draws }) => draws)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("offer the glyph's own axes beside the font's", async () => {
    await editor.openGlyph("dot");
    const groups = new ConditionChipSpace(editor.asEditor(), editor.glyphNamed("dot")!.id)
      .axisGroups;

    expect(groups.map(({ label, axes }) => [label, axes.map(({ name }) => name)])).toEqual([
      ["Font axes", ["Bleed"]],
      ["Glyph axes", ["Spread", "Strike"]],
    ]);
  });
});

describe("a component whose condition fails here", () => {
  it("is drawn as a ghost and drawn again where it holds", async () => {
    editor.setLocation({ BLED: 100 });
    const ghosted = await editor.drawnGlyph();

    expect(ghosted.components.map(({ draws }) => draws)).toEqual([true, false, false]);
    expect(ghosted.bounds).toMatchObject({ max: { x: 120 } });

    editor.setLocation({ BLED: 50 });
    expect((await editor.drawnGlyph()).components.map(({ draws }) => draws)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("stays selectable", async () => {
    editor.setLocation({ BLED: 100 });
    await editor.editSources(["Bled"]);
    await selectDots(2);

    expect(shown()).toEqual({ chips: ["Bleed ≤ 50"], mixed: false });
  });
});
