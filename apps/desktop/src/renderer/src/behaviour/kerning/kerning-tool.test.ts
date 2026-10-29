import { beforeEach, describe, expect, it } from "vitest";
import type { Point2D } from "@shift/geo";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

// The text is "TA" at LightCondensed, the default source: T kerns with A's
// second-position group by -75 there. T is the open glyph, drawn from 0.
const editor = useTestEditor({ file: FONTS.mutatorSans, glyph: "T" });
/** The middle of the T–A kern, half way up the line, as the text first lays it out. */
let center: Point2D;
beforeEach(async () => {
  editor.selectTool("text");
  editor.typeText("A");
  await editor.pressKey("Escape");
  editor.selectTool("kerning");
  const [t] = editor.canvasText()!.glyphs;
  center = { x: t!.left + t!.advance + t!.kern / 2, y: 300 };
});

describe("the Kerning tool", () => {
  it("shows the kern under the pointer and the pair it comes from", () => {
    editor.movePointerTo(center);

    expect(editor.kerningTool()).toMatchObject({
      hovered: {
        amount: -75,
        pair: {
          amount: -75,
          first: { name: "T", group: false, locked: true, toggleable: false },
          second: { group: true, locked: false, toggleable: true },
        },
      },
    });
  });

  it("finds every other place the hovered kern applies, and none it does not", () => {
    editor.selectTool("text");
    editor.typeText("TAT");
    editor.selectTool("kerning");

    editor.movePointerTo(center);

    // "TATAT": the second T–A uses the same kern; A–T pairs do not.
    expect(editor.kerningTool()).toMatchObject({ sameAsHovered: [{ amount: -75 }] });
  });

  it("selects a clicked kern, which the sidebar shows", async () => {
    expect(editor.kerningTool()).toMatchObject({ selected: null });

    await editor.clickAt({ x: center.x, y: 120 });

    expect(editor.kerningTool()).toMatchObject({ selected: { amount: -75 } });
  });

  it("drops the selected kern when an undo takes one of its glyphs away", async () => {
    await editor.clickAt(center);
    expect(editor.kerningTool()).toMatchObject({ selected: expect.anything() });

    // Undo past the typing removes the A, so T has no neighbour to kern with.
    await editor.undo();

    expect(editor.canvasText()).toMatchObject({ glyphs: [{ name: "T" }] });
    expect(editor.kerningTool()).toMatchObject({ selected: null });
  });

  it("opens the pair up by a drag right, as one undo step", async () => {
    await editor.dragFrom(center, { x: center.x + 20, y: center.y });

    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ name: "T", kern: -55 }, { name: "A" }],
    });
    await editor.undo();
    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ name: "T", kern: -75 }, { name: "A" }],
    });
  });

  it("shows a drag's kern while it drags, and Escape puts it back without saving it", async () => {
    editor.holdDragFrom(center, { x: center.x + 20, y: center.y });
    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ name: "T", kern: -55 }, { name: "A" }],
    });
    await editor.pressKey("Escape");

    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ name: "T", kern: -75 }, { name: "A" }],
    });
    await editor.settle();
    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ name: "T", kern: -75 }, { name: "A" }],
    });
  });

  it("nudges the selected kern with the arrow keys, by 10 with Shift", async () => {
    await editor.clickAt({ x: center.x, y: 120 });

    await editor.pressKey("ArrowLeft");
    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ name: "T", kern: -76 }, { name: "A" }],
    });

    await editor.pressKey("ArrowRight", { shiftKey: true });
    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ name: "T", kern: -66 }, { name: "A" }],
    });
  });

  it("locks a side to its glyph at the active source without moving the kern", async () => {
    await editor.clickAt(center);

    expect(editor.toggleKerningLock("second")).toBe(true);
    await editor.settle();

    expect(editor.kerningTool()).toMatchObject({
      selected: { pair: { second: { name: "A", group: false } } },
    });
    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ name: "T", kern: -75 }, { name: "A" }],
    });
  });

  it("opens the value below the baseline for typing, which sets the kern", async () => {
    editor.movePointerTo(center);
    const { baseline, bottom } = editor.kerningTool()!.hovered!;

    await editor.clickAt({ x: center.x, y: (baseline + bottom) / 2 });
    expect(editor.kerningTool()).toMatchObject({ editing: { amount: -75 } });

    editor.typeKerning(-100);
    await editor.settle();

    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ name: "T", kern: -100 }, { name: "A" }],
    });
    expect(editor.kerningTool()).toMatchObject({ editing: { amount: -100 } });
  });
});

describe("the Spacing tool in a kerned gap", () => {
  beforeEach(() => editor.selectTool("spacing"));

  it("shows nothing in the kern itself, and a drag there leaves the sidebearings alone", async () => {
    const before = (await editor.drawnGlyph()).sidebearings;

    editor.movePointerTo(center);
    expect(editor.spacingTool()).toMatchObject({ hovered: null });

    await editor.dragFrom(center, { x: center.x + 40, y: center.y });
    expect((await editor.drawnGlyph()).sidebearings).toEqual(before);
    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ name: "T", kern: -75 }, { name: "A" }],
    });
  });

  it("measures each glyph's sidebearing to its own advance edge, leaving the kern between", async () => {
    const rsb = (await editor.drawnGlyph()).sidebearings.rsb!;
    const [t, a] = editor.canvasText()!.glyphs;
    const inStrip = { x: t!.left + t!.advance - rsb / 2, y: 300 };

    editor.movePointerTo(inStrip);

    expect(editor.spacingTool()).toMatchObject({
      hovered: {
        side: "left",
        scope: "glyph",
        gap: { left: { glyph: "T" }, leftBoundary: t!.left + t!.advance, rightBoundary: a!.left },
      },
    });
  });

  it("drags T's own right sidebearing where its strip reaches into the kern", async () => {
    const rsb = (await editor.drawnGlyph()).sidebearings.rsb!;
    const [t] = editor.canvasText()!.glyphs;
    const inStrip = { x: t!.left + t!.advance - rsb / 2, y: 300 };

    await editor.dragFrom(inStrip, { x: inStrip.x + 10, y: 300 });

    expect((await editor.drawnGlyph()).sidebearings.rsb).toBe(rsb + 10);
    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ name: "T", kern: -75 }, { name: "A" }],
    });
  });
});
