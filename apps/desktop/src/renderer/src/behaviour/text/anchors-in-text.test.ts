import { describe, expect, it } from "vitest";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

// Text lays out as the exported font sets it: a mark attaches only when the
// font classes it as a mark, and marks follow the anchors they use while one
// is dragged. Cursive joins follow the same staged drag frame; their rule is
// checked in shift-font and against the exported font.

describe("shaped text attaches only the glyphs the font classes as marks", () => {
  const editor = useTestEditor({ file: FONTS.anchorDragBench, glyph: "a" });

  /** Types `text` after the open glyph and returns where each typed glyph is drawn. */
  async function typed(text: string, names: string[]) {
    editor.selectTool("text");
    editor.deleteBackward();
    editor.typeText(text);
    await editor.settle();
    const glyphs = editor.canvasText()!.glyphs;
    expect(glyphs.map((glyph) => glyph.name)).toEqual(names);
    return glyphs.map((glyph) => glyph.origin);
  }

  it("sets a spacing dieresis beside the letter, though its component lends it a _top anchor", async () => {
    const [a, dieresis] = await typed("a¨", ["a", "dieresis"]);

    expect(a).toEqual({ x: 0, y: 0 });
    // After a's 480-unit advance, on the baseline.
    expect(dieresis).toEqual({ x: 480, y: 0 });
  });

  it("attaches a combining dieresis to the letter's top anchor", async () => {
    const [, mark] = await typed("ä", ["a", "dieresiscomb"]);

    // The mark's _top (150, 500) on a's top (240, 500).
    expect(mark).toEqual({ x: 90, y: 0 });
  });

  it("stacks a second combining dieresis on the first", async () => {
    const [, first, second] = await typed("ä̈", ["a", "dieresiscomb", "dieresiscomb"]);

    expect(first).toEqual({ x: 90, y: 0 });
    // The second mark's _top (150, 500) on the first mark's top (90 + 150, 650).
    expect(second).toEqual({ x: 90, y: 150 });
  });
});

describe("text follows the anchors its marks use while one is dragged", () => {
  // The open glyph is beh-ar, with its `top` anchor at (250, 600).
  const editor = useTestEditor({ file: FONTS.shapingTest, glyph: "beh-ar" });

  /** Types `text` after the open glyph, then goes back to editing it. */
  async function typedAfter(text: string): Promise<void> {
    editor.selectTool("text");
    editor.typeText(text);
    await editor.pressKey("Escape");
    await editor.settle();
    editor.selectTool("select");
  }

  it("keeps the layout when an anchor no mark uses moves", async () => {
    await typedAfter("ب");
    const top = (await editor.anchorNamed("top"))!.id;
    const before = editor.textLayoutCount();

    editor.holdDragAnchor(top, { x: 30, y: 40 });

    expect(editor.textLayoutCount()).toBe(before);
  });

  it("moves a mark with the base anchor it attaches to, while the anchor is dragged", async () => {
    await typedAfter("\u064e");
    // Right to left, the mark is drawn first on screen.
    const [mark] = editor.canvasText()!.glyphs;
    expect(mark).toMatchObject({ name: "fatha-ar" });

    editor.holdDragAnchor((await editor.anchorNamed("top"))!.id, { x: 30, y: 0 });

    expect(editor.canvasText()).toMatchObject({
      glyphs: [
        { name: "fatha-ar", origin: { x: mark!.origin.x + 30, y: mark!.origin.y } },
        expect.anything(),
      ],
    });
  });
});
