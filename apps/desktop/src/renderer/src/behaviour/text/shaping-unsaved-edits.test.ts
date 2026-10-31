import { beforeEach, describe, expect, it } from "vitest";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor({ file: FONTS.undrawnLigature, glyph: "f" });

describe("text shapes with the font as it is edited, before it is saved", () => {
  // The canvas text starts as the open glyph, f; each test types over it.
  beforeEach(() => {
    editor.selectTool("text");
    editor.deleteBackward();
  });

  it("forms a ligature once the glyph its feature code names is added", async () => {
    editor.typeText("fi");
    await editor.settle();
    expect(editor.canvasText()).toMatchObject({ glyphs: [{ name: "f" }, { name: "i" }] });

    await editor.addGlyph("f_i", null);
    await editor.settle();

    expect(editor.canvasText()).toMatchObject({ glyphs: [{ name: "f_i" }] });
  });

  it("shows a glyph its feature code does not name as soon as it is added", async () => {
    await editor.addGlyph("x", 0x78);
    editor.typeText("xfi");
    await editor.settle();
    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ name: "x" }, { name: "f" }, { name: "i" }],
    });

    await editor.addGlyph("f_i", null);
    await editor.settle();

    expect(editor.canvasText()).toMatchObject({ glyphs: [{ name: "x" }, { name: "f_i" }] });
  });
});
