import { beforeEach, describe, expect, it } from "vitest";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor({ file: FONTS.shapingTest, glyph: "f" });

/** The canvas text, which every test here has. */
function text() {
  const shown = editor.canvasText();
  if (!shown) throw new Error("the canvas shows no text");
  return shown;
}

const names = () => text().glyphs.map((glyph) => glyph.name);

describe("typed text is shaped with the font's feature code", () => {
  // The canvas text starts as the open glyph, f; each test types over it.
  beforeEach(() => {
    editor.selectTool("text");
    editor.deleteBackward();
  });

  it.each([
    ["a ligature", "fi", ["f_i"]],
    ["ligatures among spaces", "fi fifi f", ["f_i", "space", "f_i", "f_i", "space", "f"]],
    [
      "Arabic joining forms",
      "ببب بب",
      ["beh-ar.fina", "beh-ar.init", "space", "beh-ar.fina", "beh-ar.medi", "beh-ar.init"],
    ],
    ["marks on a base", "بَّ", ["fatha-ar", "shadda-ar", "beh-ar"]],
  ])(
    "shapes %s to the font's substituted glyphs, in display order",
    async (_case, typed, expected) => {
      editor.typeText(typed);
      await editor.settle();

      expect(names()).toEqual(expected);
    },
  );

  it("forms a ligature that covers both typed characters", async () => {
    editor.typeText("fi");
    await editor.settle();

    expect(names()).toEqual(["f_i"]);
    expect(text().glyphs[0]!.itemIds).toEqual(text().items.map((item) => item.id));
  });

  it("joins Arabic into positional forms laid out right to left", async () => {
    editor.typeText("ببب");
    await editor.settle();

    expect(names()).toEqual(["beh-ar.fina", "beh-ar.medi", "beh-ar.init"]);
    expect(text().glyphs.map((glyph) => glyph.left)).toEqual([0, 450, 850]);
  });

  it("places a mark on its base's anchor and a second mark on the first", async () => {
    editor.typeText("بَّ");
    await editor.settle();

    expect(text().glyphs.map(({ name, origin }) => ({ name, origin }))).toEqual([
      { name: "fatha-ar", origin: { x: 350, y: 300 } },
      { name: "shadda-ar", origin: { x: 350, y: 100 } },
      { name: "beh-ar", origin: { x: 0, y: 0 } },
    ]);
    expect(text().advance).toBe(500);
  });

  it("shapes new text at once when typed after the shaper is ready", async () => {
    editor.typeText("fi");
    await editor.settle();

    editor.typeText("fi");

    expect(names()).toEqual(["f_i", "f_i"]);
  });
});

describe("double-clicking a character the font draws with several glyphs", () => {
  // Noon is drawn as a dotless body and a dot: the text is f, then noon's dot and body.
  beforeEach(async () => {
    editor.selectTool("text");
    editor.typeText("ن");
    await editor.pressKey("Escape");
    expect(names()).toEqual(["f", "dotabove-ar", "noonDotless-ar"]);
  });

  it("edits the body that was clicked and still shows the dot as text", async () => {
    const [, dot, body] = text().glyphs;

    await editor.doubleClickAt({ x: body!.origin.x + 250, y: 250 });
    expect(text().openGlyph).toBe("noonDotless-ar");

    // The body is now the open glyph, so positions are measured from its origin.
    editor.movePointerTo({
      x: dot!.origin.x - body!.origin.x - 100,
      y: dot!.origin.y - body!.origin.y + 550,
    });
    expect(text().hoveredItemId).toBe(dot!.itemIds[0]);
  });

  it("edits the dot when the dot is clicked", async () => {
    const [, dot] = text().glyphs;

    await editor.doubleClickAt({ x: dot!.origin.x - 100, y: dot!.origin.y + 550 });

    expect(text().openGlyph).toBe("dotabove-ar");
  });
});
