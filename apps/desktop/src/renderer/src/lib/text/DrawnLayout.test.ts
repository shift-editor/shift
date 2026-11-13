import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EditorTestSurface } from "@/testing/surface";
import { openTestEditor } from "@/testing/TestEditor";

const FONT = resolve(process.cwd(), "../../fixtures/fonts/ShapingTest.ufo");

describe("the glyphs a run is drawn with", () => {
  let editor: EditorTestSurface;

  afterEach(() => editor.close());

  it("stay the last drawable ones while a glyph shaping brought in loads", async () => {
    editor = await openTestEditor(FONT, "f");
    editor.selectTool("text");
    editor.deleteBackward();
    editor.typeText("f");
    await editor.settle();
    expect(editor.drawnTextGlyphs()).toEqual(["f"]);

    // "fi" shapes to f_i, whose model has never loaded. The run's layout,
    // which carets and edits read, has it at once; the drawn glyphs stay
    // until it loads, rather than blanking.
    editor.typeText("i");
    expect(editor.canvasText()).toMatchObject({ glyphs: [{ name: "f_i" }] });
    expect(editor.drawnTextGlyphs()).toEqual(["f"]);

    await editor.settle();
    expect(editor.drawnTextGlyphs()).toEqual(["f_i"]);
  });
});
