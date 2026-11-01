import { beforeEach, describe, expect, it } from "vitest";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor({ file: FONTS.shapingTest, glyph: "f" });

// The canvas text starts as the open glyph, f; each test types over it.
beforeEach(() => {
  editor.selectTool("text");
  editor.deleteBackward();
});

describe("what a feature changes in proof text", () => {
  it("lists the glyphs each substitution of a feature replaces and brings in", () => {
    expect(editor.featureSubstitutions("liga")).toEqual([{ input: ["f", "i"], output: "f_i" }]);
    expect(editor.featureSubstitutions("locl")).toEqual(
      expect.arrayContaining([{ input: ["i"], output: "i.loclTRK" }]),
    );
    expect(editor.featureSubstitutions("smcp")).toEqual([]);
  });

  it("says why a feature's substitutions cannot be read, rather than listing none", () => {
    expect(() => editor.featureSubstitutions("ligatures")).toThrow("FeatureListError.invalidTag");
  });

  it("highlights what a feature brings in while it is on, and what it replaces while off", async () => {
    editor.typeText("fi");
    await editor.settle();

    editor.highlightFeature("liga");
    expect(editor.highlightedGlyphs()).toEqual(["f_i"]);

    editor.setTextFeature("liga", false);
    expect(editor.highlightedGlyphs().toSorted()).toEqual(["f", "i"]);

    editor.highlightFeature(null);
    expect(editor.highlightedGlyphs()).toEqual([]);
  });
});
