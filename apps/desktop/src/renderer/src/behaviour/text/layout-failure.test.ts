import { beforeEach, describe, expect, it } from "vitest";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor({ file: FONTS.shapingTest, glyph: "f" });

// The canvas text starts as the open glyph, f; each test types over it.
beforeEach(() => {
  editor.selectTool("text");
  editor.deleteBackward();
});

describe("the canvas says why proof text is not shown", () => {
  it("when laying the text out fails, and clears once it lays out again", async () => {
    editor.failNextTextLayout("the text is too long to lay out");

    editor.typeText("f");

    expect(editor.textLayoutFailure()).toEqual({
      stage: "layout",
      message: "the text is too long to lay out",
    });
    expect(editor.canvasText()).toBeNull();

    editor.typeText("i");
    await editor.settle();

    expect(editor.textLayoutFailure()).toBeNull();
  });

  it("when the engine cannot load a glyph the text shows", async () => {
    // Shaping "fi" brings in f_i, whose layers the engine has not loaded.
    editor.failNextGlyphPreload("the store reader is closed");

    editor.typeText("fi");
    await editor.settle();

    expect(editor.textLayoutFailure()).toEqual({
      stage: "preload",
      message: "the store reader is closed",
    });
  });
});
