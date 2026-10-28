import { afterEach, describe, expect, it } from "vitest";
import { FONTS, type FontFile } from "@/testing/fontFixture";
import type { EditorTestSurface } from "@/testing/surface";
import { openTestEditor } from "@/testing/TestEditor";

let editor: EditorTestSurface;
afterEach(() => editor.close());

// T followed by A kerns through A's second-position group at every master:
// LightCondensed -75, BoldCondensed -65, LightWide -215, BoldWide -150.

/** Opens `font` on T and types `typed` after it. */
async function typeAfterT(font: FontFile, typed: string): Promise<EditorTestSurface> {
  const opened = await openTestEditor(font, "T");
  opened.selectTool("text");
  opened.typeText(typed);
  await opened.pressKey("Escape");
  return opened;
}

/** The two glyphs of the canvas text. */
function pair() {
  const [first, second] = editor.canvasText()!.glyphs;
  return { first: first!, second: second! };
}

describe("kerning in typed text", () => {
  it("moves the second glyph by the pair's kerning and keeps both advances", async () => {
    editor = await typeAfterT(FONTS.mutatorSans, "A");
    const { first, second } = pair();

    expect(first.kern).toBe(-75);
    expect(second.kern).toBe(0);
    expect(second.left).toBe(first.left + first.advance - 75);
  });

  it("shows each master's own pairs", async () => {
    editor = await typeAfterT(FONTS.mutatorSans, "A");

    editor.clickSource("BoldWide");
    expect(pair().first.kern).toBe(-150);
    expect(pair().second.left).toBe(pair().first.left + pair().first.advance - 150);

    editor.setLocation({ wdth: 1000, wght: 0 });
    expect(pair().first.kern).toBe(-215);
  });

  it("blends the masters between them, including on a support layer without kerning", async () => {
    editor = await typeAfterT(FONTS.mutatorSans, "A");

    editor.setLocation({ wdth: 500, wght: 500 });
    expect(pair().first.kern).toBeCloseTo(-126.25);

    // The crossbar support layer sits at weight 700 and authors no pairs.
    editor.setLocation({ wdth: 0, wght: 700 });
    expect(pair().first.kern).toBeCloseTo(-68);
  });

  it("uses the only source of a static font", async () => {
    editor = await typeAfterT(FONTS.mutatorSansLightCondensed, "AT");

    const [t, a] = editor.canvasText()!.glyphs;
    expect(t!.kern).toBe(-75);
    expect(a!.kern).toBe(0);
  });
});
