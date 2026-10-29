import { beforeEach, describe, expect, it } from "vitest";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

// T followed by A kerns through A's second-position group at every master:
// LightCondensed -75, BoldCondensed -65, LightWide -215, BoldWide -150.

describe("kerning in typed text", () => {
  const editor = useTestEditor({ file: FONTS.mutatorSans, glyph: "T" });
  beforeEach(async () => {
    editor.selectTool("text");
    editor.typeText("A");
    await editor.pressKey("Escape");
  });

  it("moves the second glyph by the pair's kerning and keeps both advances", () => {
    const [first] = editor.canvasText()!.glyphs;

    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ kern: -75 }, { kern: 0, left: first!.left + first!.advance - 75 }],
    });
  });

  it("shows each master's own pairs", () => {
    editor.clickSource("BoldWide");
    const [first] = editor.canvasText()!.glyphs;
    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ kern: -150 }, { left: first!.left + first!.advance - 150 }],
    });

    editor.setLocation({ wdth: 1000, wght: 0 });
    expect(editor.canvasText()).toMatchObject({ glyphs: [{ kern: -215 }, expect.anything()] });
  });

  it("blends the masters between them, including on a support layer without kerning", () => {
    editor.setLocation({ wdth: 500, wght: 500 });
    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ kern: expect.closeTo(-126.25) }, expect.anything()],
    });

    // The crossbar support layer sits at weight 700 and authors no pairs.
    editor.setLocation({ wdth: 0, wght: 700 });
    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ kern: expect.closeTo(-68) }, expect.anything()],
    });
  });
});

describe("kerning in typed text", () => {
  const editor = useTestEditor({ file: FONTS.mutatorSansLightCondensed, glyph: "T" });

  it("uses the only source of a static font", async () => {
    editor.selectTool("text");
    editor.typeText("AT");
    await editor.pressKey("Escape");

    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ kern: -75 }, { kern: 0 }, expect.anything()],
    });
  });
});
