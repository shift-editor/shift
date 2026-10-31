import { beforeEach, describe, expect, it } from "vitest";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor({ file: FONTS.shapingTest, glyph: "f" });

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

      expect(editor.canvasText()).toMatchObject({
        glyphs: expected.map((name) => ({ name })),
      });
    },
  );

  it("forms a ligature that covers both typed characters", async () => {
    editor.typeText("fi");
    await editor.settle();

    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ name: "f_i", itemIds: editor.canvasText()!.items.map((item) => item.id) }],
    });
  });

  it("joins Arabic into positional forms laid out right to left", async () => {
    editor.typeText("ببب");
    await editor.settle();

    expect(editor.canvasText()).toMatchObject({
      glyphs: [
        { name: "beh-ar.fina", left: 0 },
        { name: "beh-ar.medi", left: 450 },
        { name: "beh-ar.init", left: 850 },
      ],
    });
  });

  it("places a mark on its base's anchor and a second mark on the first", async () => {
    editor.typeText("بَّ");
    await editor.settle();

    expect(editor.canvasText()).toMatchObject({
      glyphs: [
        { name: "fatha-ar", origin: { x: 350, y: 300 } },
        { name: "shadda-ar", origin: { x: 350, y: 100 } },
        { name: "beh-ar", origin: { x: 0, y: 0 } },
      ],
      advance: 500,
    });
  });

  it("shapes new text at once when typed after the shaper is ready", async () => {
    editor.typeText("fi");
    await editor.settle();

    editor.typeText("fi");

    expect(editor.canvasText()).toMatchObject({ glyphs: [{ name: "f_i" }, { name: "f_i" }] });
  });
});

describe("double-clicking a character the font draws with several glyphs", () => {
  // Noon is drawn as a dotless body and a dot: the text is f, then noon's dot and body.
  beforeEach(async () => {
    editor.selectTool("text");
    editor.typeText("ن");
    await editor.pressKey("Escape");
    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ name: "f" }, { name: "dotabove-ar" }, { name: "noonDotless-ar" }],
    });
  });

  it("edits the body that was clicked and still shows the dot as text", async () => {
    const [, dot, body] = editor.canvasText()!.glyphs;

    await editor.doubleClickAt({ x: body!.origin.x + 250, y: 250 });
    expect(editor.canvasText()).toMatchObject({ openGlyph: "noonDotless-ar" });

    // The body is now the open glyph, so positions are measured from its origin.
    editor.movePointerTo({
      x: dot!.origin.x - body!.origin.x - 100,
      y: dot!.origin.y - body!.origin.y + 550,
    });
    expect(editor.canvasText()).toMatchObject({ hoveredItemId: dot!.itemIds[0] });
  });

  it("edits the dot when the dot is clicked", async () => {
    const [, dot] = editor.canvasText()!.glyphs;

    await editor.doubleClickAt({ x: dot!.origin.x - 100, y: dot!.origin.y + 550 });

    expect(editor.canvasText()).toMatchObject({ openGlyph: "dotabove-ar" });
  });
});
