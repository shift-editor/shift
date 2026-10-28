import { beforeEach, describe, expect, it } from "vitest";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

// The text is "TA" at LightCondensed, the default source: T kerns with A's
// second-position group by -75 there. T is the open glyph, drawn from 0.
const editor = useTestEditor({ file: FONTS.mutatorSans, glyph: "T" });
beforeEach(async () => {
  editor.selectTool("text");
  editor.typeText("A");
  await editor.pressKey("Escape");
  editor.selectTool("kerning");
});

/** The first two glyphs of the text. */
function tA() {
  const [t, a] = editor.canvasText()!.glyphs;
  return { t: t!, a: a! };
}

/** The kern shown between T and A: the space between T's advance box and A's. */
function kern(): number {
  const { t, a } = tA();
  return a.left - (t.left + t.advance);
}

/** The middle of the kern, half way up the line. */
function kernCenter(y = 300) {
  const { t, a } = tA();
  return { x: (t.left + t.advance + a.left) / 2, y };
}

const kerning = () => editor.kerningTool()!;

describe("the Kerning tool", () => {
  it("shows the kern under the pointer and the pair it comes from", () => {
    editor.movePointerTo(kernCenter());

    expect(kerning().hovered).toMatchObject({
      amount: -75,
      pair: {
        amount: -75,
        first: { name: "T", group: false, locked: true, toggleable: false },
        second: { group: true, locked: false, toggleable: true },
      },
    });
  });

  it("finds every other place the hovered kern applies, and none it does not", () => {
    editor.selectTool("text");
    editor.typeText("TAT");
    editor.selectTool("kerning");

    editor.movePointerTo(kernCenter());

    // "TATAT": the second T–A uses the same kern; A–T pairs do not.
    expect(kerning().sameAsHovered).toHaveLength(1);
    expect(kerning().sameAsHovered[0]!.amount).toBe(-75);
  });

  it("selects a clicked kern, which the sidebar shows", async () => {
    expect(kerning().selected).toBeNull();

    await editor.clickAt(kernCenter(120));

    expect(kerning().selected?.amount).toBe(-75);
  });

  it("drops the selected kern when an undo takes one of its glyphs away", async () => {
    await editor.clickAt(kernCenter());
    expect(kerning().selected).not.toBeNull();

    // Undo past the typing removes the A, so T has no neighbour to kern with.
    await editor.undo();

    expect(editor.canvasText()!.glyphs).toHaveLength(1);
    expect(kerning().selected).toBeNull();
  });

  it("opens the pair up by a drag right, as one undo step", async () => {
    const center = kernCenter();

    await editor.dragFrom(center, { x: center.x + 20, y: center.y });

    expect(kern()).toBe(-55);
    await editor.undo();
    expect(kern()).toBe(-75);
  });

  it("shows a drag's kern while it drags, and Escape puts it back without saving it", async () => {
    const center = kernCenter();

    editor.holdDragFrom(center, { x: center.x + 20, y: center.y });
    expect(kern()).toBe(-55);
    await editor.pressKey("Escape");

    expect(kern()).toBe(-75);
    await editor.settle();
    expect(kern()).toBe(-75);
  });

  it("nudges the selected kern with the arrow keys, by 10 with Shift", async () => {
    await editor.clickAt(kernCenter(120));

    await editor.pressKey("ArrowLeft");
    expect(kern()).toBe(-76);

    await editor.pressKey("ArrowRight", { shiftKey: true });
    expect(kern()).toBe(-66);
  });

  it("locks a side to its glyph at the active source without moving the kern", async () => {
    await editor.clickAt(kernCenter());

    expect(editor.toggleKerningLock("second")).toBe(true);
    await editor.settle();

    expect(kerning().selected?.pair?.second).toMatchObject({ name: "A", group: false });
    expect(kern()).toBe(-75);
  });

  it("opens the value below the baseline for typing, which sets the kern", async () => {
    editor.movePointerTo(kernCenter());
    const { baseline, bottom } = kerning().hovered!;

    await editor.clickAt(kernCenter((baseline + bottom) / 2));
    expect(kerning().editing?.amount).toBe(-75);

    editor.typeKerning(-100);
    await editor.settle();

    expect(kern()).toBe(-100);
    expect(kerning().editing?.amount).toBe(-100);
  });
});

describe("the Spacing tool in a kerned gap", () => {
  beforeEach(() => editor.selectTool("spacing"));

  /** T's sidebearings, as its bounds and advance give them. */
  async function tSidebearings() {
    const bounds = (await editor.outlineBounds())!;
    return { lsb: bounds.min.x, rsb: (await editor.advanceWidth()) - bounds.max.x };
  }

  it("shows nothing in the kern itself, and a drag there leaves the sidebearings alone", async () => {
    const before = await tSidebearings();
    const center = kernCenter();

    editor.movePointerTo(center);
    expect(editor.spacingTool()?.hovered).toBeNull();

    await editor.dragFrom(center, { x: center.x + 40, y: center.y });
    expect(await tSidebearings()).toEqual(before);
    expect(kern()).toBe(-75);
  });

  it("measures each glyph's sidebearing to its own advance edge, leaving the kern between", async () => {
    const { rsb } = await tSidebearings();
    const { t, a } = tA();
    const inStrip = { x: t.left + t.advance - rsb / 2, y: 300 };

    editor.movePointerTo(inStrip);

    expect(editor.spacingTool()?.hovered).toMatchObject({
      side: "left",
      scope: "glyph",
      gap: { left: { glyph: "T" }, leftBoundary: t.left + t.advance, rightBoundary: a.left },
    });
  });

  it("drags T's own right sidebearing where its strip reaches into the kern", async () => {
    const { rsb } = await tSidebearings();
    const { t } = tA();
    const inStrip = { x: t.left + t.advance - rsb / 2, y: 300 };

    await editor.dragFrom(inStrip, { x: inStrip.x + 10, y: 300 });

    expect((await tSidebearings()).rsb).toBe(rsb + 10);
    expect(kern()).toBe(-75);
  });
});
