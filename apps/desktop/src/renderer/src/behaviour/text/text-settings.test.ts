import { beforeEach, describe, expect, it } from "vitest";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor({ file: FONTS.shapingTest, glyph: "f" });

// The canvas text starts as the open glyph, f; each test types over it.
beforeEach(() => {
  editor.selectTool("text");
  editor.deleteBackward();
});

describe("features turned on or off in the text", () => {
  it("turning a feature off sets its characters apart, and its default brings it back", async () => {
    editor.typeText("fi");
    await editor.settle();

    editor.setTextFeature("liga", false);
    expect(editor.canvasText()).toMatchObject({ glyphs: [{ name: "f" }, { name: "i" }] });

    editor.setTextFeature("liga", null);
    expect(editor.canvasText()).toMatchObject({ glyphs: [{ name: "f_i" }] });
  });

  it("turning on a feature the font leaves off applies it, and undo takes it off", async () => {
    editor.typeText("ff");
    await editor.settle();
    expect(editor.canvasText()).toMatchObject({ glyphs: [{ name: "f" }, { name: "f" }] });

    editor.setTextFeature("dlig", true);
    expect(editor.canvasText()).toMatchObject({ glyphs: [{ name: "f_i" }] });

    await editor.undo();
    expect(editor.canvasText()).toMatchObject({ glyphs: [{ name: "f" }, { name: "f" }] });
  });

  it("lists the font's features with the names and defaults Rust gives them", () => {
    expect(editor.textFeatures()).toEqual(
      expect.arrayContaining([
        { tag: "dlig", name: "Discretionary Ligatures", default: "off", group: "ligatures" },
        { tag: "liga", name: "Standard Ligatures", default: "on", group: "ligatures" },
        { tag: "init", name: "Initial Forms", default: "required", group: "other" },
      ]),
    );
  });

  it("says why the font's features cannot be listed, rather than listing none", () => {
    editor.failFeatureLists("the feature code has errors");

    expect(editor.featureListFailure()).toBe(
      "This font has no shaper yet, so its features can't be listed.",
    );
  });
});

describe("the language and script the text is shaped in", () => {
  it("shapes Turkish with the font's localized i, and undo drops it", async () => {
    editor.typeText("i");
    await editor.settle();

    editor.setTextLanguage("tr");
    expect(editor.canvasText()).toMatchObject({ glyphs: [{ name: "i.loclTRK" }] });

    await editor.undo();
    expect(editor.canvasText()).toMatchObject({ glyphs: [{ name: "i" }] });
  });

  it("reports the scripts the text was laid out in, in order of first use", async () => {
    editor.typeText("fi بب fi");
    await editor.settle();

    expect(editor.textScripts()).toEqual(["Latn", "Arab"]);
  });

  it("shapes digits in Arabic script with the font's Arabic forms", async () => {
    editor.typeText("1");
    await editor.settle();
    expect(editor.canvasText()).toMatchObject({ glyphs: [{ name: "one" }] });

    editor.setTextScript("Arab");

    expect(editor.canvasText()).toMatchObject({ glyphs: [{ name: "one.arab" }] });
  });
});

describe("how the text's lines are set", () => {
  it("spaces baselines by the line height in ems, and Auto returns the font's", async () => {
    editor.typeText("f\nf");
    await editor.settle();
    const { baselines } = editor.canvasText()!;

    editor.setTextLineHeight(1.5);
    expect(editor.canvasText()).toMatchObject({ baselines: [0, -1500] });

    editor.setTextLineHeight(null);
    expect(editor.canvasText()).toMatchObject({ baselines });
  });

  it("keeps lines at least a tenth of an em apart", async () => {
    editor.typeText("f\nf");
    await editor.settle();

    editor.setTextLineHeight(0);

    expect(editor.canvasText()).toMatchObject({ baselines: [0, -100] });
  });

  it("keeps the text at least one unit to the em, and undo restores its size", async () => {
    const size = editor.textSize();

    editor.setTextSize(-5);
    expect(editor.textSize()).toBe(1);

    await editor.undo();
    expect(editor.textSize()).toBe(size);
  });

  it("starts an Arabic line on the right until an alignment is chosen", async () => {
    editor.typeText("ببب\nبب");
    await editor.settle();
    const lines = editor.canvasText()!.glyphs;
    const firstLineRight = lines[2]!.left + lines[2]!.advance;
    const secondLineRight = lines[4]!.left + lines[4]!.advance;

    expect(secondLineRight).toBe(firstLineRight);
  });

  it("lines a shorter line up on the right of a longer one", async () => {
    editor.typeText("fi\nf");
    await editor.settle();
    const [ligature, f] = editor.canvasText()!.glyphs;

    editor.setTextAlign("right");
    expect(editor.canvasText()).toMatchObject({
      glyphs: [
        { name: "f_i", left: 0 },
        { name: "f", left: ligature!.advance - f!.advance },
      ],
    });

    editor.setTextAlign("center");
    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ left: 0 }, { left: (ligature!.advance - f!.advance) / 2 }],
    });
  });
});
