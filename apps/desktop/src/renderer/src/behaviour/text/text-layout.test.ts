import { beforeEach, describe, expect, it } from "vitest";
import { NONSPACING_MARK_EDITOR_ADVANCE } from "@shift/editor/text";
import { triangle } from "@/testing/fixtures";
import { FONTS, useTestEditor, type FontFixture } from "@/testing/fontFixture";

/** A new font's line height: ascender 800 less descender -200, with no line gap. */
const LINE_HEIGHT = 1000;

/**
 * A font whose A (a triangle), B and C advance 500, 600 and 700. In Text mode
 * the canvas text is `A`, with the caret after it.
 *
 * @remarks
 * The session is a preview, whose text is never shaped, so the text lays out
 * each glyph as typed, without the font's features.
 */
const ABC = {
  mode: "preview",
  glyphs: {
    A: { outline: { contours: [triangle([0, 0], [100, 0], [50, 100])] } },
    B: { unicode: 66, outline: { advance: 600 } },
    C: { unicode: 67, outline: { advance: 700 } },
  },
} satisfies FontFixture;

describe("laying out typed text", () => {
  const editor = useTestEditor(ABC);
  beforeEach(() => editor.selectTool("text"));

  it("advances the text by the sum of its glyphs' advances", async () => {
    editor.typeText("BC");

    expect(editor.canvasText()).toMatchObject({
      glyphs: [
        { name: "A", left: 0, advance: 500 },
        { name: "B", left: 500, advance: 600 },
        { name: "C", left: 1100, advance: 700 },
      ],
      advance: 1800,
    });
  });

  it("shows each glyph for the item it came from, drawn from its own origin", async () => {
    editor.typeText("B");
    const [a, b] = editor.canvasText()!.items;

    expect(editor.canvasText()).toMatchObject({
      glyphs: [
        { name: "A", itemIds: [a!.id], origin: { x: 0, y: 0 } },
        { name: "B", itemIds: [b!.id], origin: { x: 500, y: 0 } },
      ],
    });
  });

  it("shows nothing and advances nothing when every item is deleted", async () => {
    editor.deleteBackward();

    expect(editor.canvasText()!).toMatchObject({
      items: [],
      glyphs: [],
      advance: 0,
      baselines: [],
    });
  });

  it("starts a new line one line height below at each line break", async () => {
    editor.typeText("A\nB");
    const [first, second, , b] = editor.canvasText()!.items;

    expect(editor.canvasText()).toMatchObject({
      baselines: [0, -LINE_HEIGHT],
      glyphs: [
        // No glyph shows the line break, the third item.
        { name: "A", line: 0, itemIds: [first!.id] },
        { name: "A", line: 0, itemIds: [second!.id] },
        { name: "B", line: 1, itemIds: [b!.id], origin: { x: 0, y: -LINE_HEIGHT } },
      ],
    });
  });

  it("lays out an empty line for a line break with nothing after it", async () => {
    editor.deleteBackward();
    editor.typeText("\n");

    expect(editor.canvasText()!).toMatchObject({
      glyphs: [],
      advance: 0,
      baselines: [0, -LINE_HEIGHT],
    });
  });

  it("shows a character the font has no glyph for with no advance", async () => {
    editor.typeText("\u{10fffd}");

    expect(editor.canvasText()).toMatchObject({
      glyphs: [expect.anything(), { glyphId: null, advance: 0 }],
    });
  });

  it("places the caret before the glyph whose left half is clicked", async () => {
    editor.typeText("B");

    await editor.clickAt({ x: 500 + 600 / 4, y: 0 });

    expect(editor.canvasText()).toMatchObject({ caret: { position: 1, x: 500, y: 0 } });
  });
});

describe("moving the caret through laid-out text", () => {
  const editor = useTestEditor(ABC);
  beforeEach(() => editor.selectTool("text"));

  it("steps one item at a time and stops at either end", async () => {
    editor.typeText("B");

    editor.moveCaret(1);
    expect(editor.canvasText()).toMatchObject({ caret: { position: 2 } });
    editor.moveCaret(-1);
    expect(editor.canvasText()).toMatchObject({ caret: { position: 1 } });
    editor.moveCaret(-1);
    editor.moveCaret(-1);
    expect(editor.canvasText()).toMatchObject({ caret: { position: 0 } });
  });

  it("steps from the end of a line to the start of the next", async () => {
    editor.typeText("\nB");
    editor.moveCaret(-1, "character");
    editor.moveCaret(-1, "character");
    editor.moveCaret(-1, "character");

    editor.moveCaret(1);
    expect(editor.canvasText()).toMatchObject({ caret: { position: 1, y: 0 } });
    editor.moveCaret(1);
    expect(editor.canvasText()).toMatchObject({
      caret: { position: 2, x: 0, y: -LINE_HEIGHT },
    });
  });

  it("puts the caret on the empty line after a line break typed at the end", async () => {
    editor.typeText("\n");

    expect(editor.canvasText()).toMatchObject({
      caret: { position: 2, x: 0, y: -LINE_HEIGHT },
    });
  });

  it("puts the caret on the empty middle line between two line breaks", async () => {
    editor.deleteBackward();
    editor.typeText("\n\n");
    editor.moveCaret(-1);

    expect(editor.canvasText()).toMatchObject({
      caret: { position: 1, x: 0, y: -LINE_HEIGHT },
    });
  });
});

describe("nonspacing marks in typed text", () => {
  // `x.comb` and `fatha-ar` are added with no advance.
  const editor = useTestEditor({
    ...ABC,
    glyphs: {
      ...ABC.glyphs,
      "x.comb": { outline: { advance: 0 } },
      "fatha-ar": { outline: { advance: 0 } },
    },
  });
  beforeEach(() => editor.selectTool("text"));

  // Glyph data reads `x.comb` as a suffixed `x`: a letter, though its name says `comb`.
  it("lays out a glyph named like a mark as spacing when its category is not a mark", async () => {
    editor.pasteText("/x.comb");

    expect(editor.canvasText()).toMatchObject({
      glyphs: [
        expect.anything(),
        { name: "x.comb", advance: 0, left: 500, origin: { x: 500, y: 0 } },
      ],
    });
  });

  // Glyph data reads `fatha-ar` as a nonspacing mark; neither name nor Unicode says so.
  it("gives a nonspacing mark a visible advance though its name does not look like one", async () => {
    editor.pasteText("/fatha-ar");

    expect(editor.canvasText()).toMatchObject({
      glyphs: [expect.anything(), { name: "fatha-ar", advance: NONSPACING_MARK_EDITOR_ADVANCE }],
    });
  });

  it("kerns a glyph named like a mark against its neighbour, but not a nonspacing mark", async () => {
    editor.setKerning("Regular", "A", "x.comb", -30);
    editor.setKerning("Regular", "A", "fatha-ar", -30);
    await editor.settle();

    editor.pasteText("/x.comb");
    expect(editor.canvasText()).toMatchObject({ glyphs: [{ kern: -30 }, expect.anything()] });

    editor.deleteBackward();
    editor.pasteText("/fatha-ar");
    expect(editor.canvasText()).toMatchObject({ glyphs: [{ kern: 0 }, expect.anything()] });
  });

  it("shows a typed character once a glyph for it is added", async () => {
    editor.typeText("\u064f");
    expect(editor.canvasText()).toMatchObject({
      glyphs: [expect.anything(), { glyphId: null, advance: 0 }],
    });

    await editor.addGlyph("damma-ar", 0x064f);

    expect(editor.canvasText()).toMatchObject({
      glyphs: [expect.anything(), { name: "damma-ar", advance: 500 }],
    });
  });
});

describe("marks attach to their base's anchors", () => {
  const editor = useTestEditor({ file: FONTS.anchorPropagation, glyph: "a" });

  // `aacute` has no anchors of its own: its `top` is `acutecomb`'s, copied in by propagation.
  it("attaches a mark to an anchor a composite takes from its components", async () => {
    editor.selectTool("text");

    editor.pasteText("/aacute/acutecomb");
    await editor.settle();

    expect(editor.canvasText()).toMatchObject({
      glyphs: [
        expect.anything(),
        { name: "aacute", origin: { x: 500, y: 0 } },
        // acutecomb's `top` (100, 700) moved by its component offset (150, 0), less its `_top` (100, 500).
        { name: "acutecomb", origin: { x: 650, y: 200 }, advance: 0 },
      ],
    });
  });

  it("moves the mark with the anchor it sits on", async () => {
    // `a`'s first anchor is `top`, where `tildecomb` sits.
    const [top] = await editor.anchors();
    editor.selectTool("text");
    editor.typeText("\u0303");
    await editor.pressKey("Escape");
    const before = editor.canvasText()!.glyphs[1]!.origin;

    editor.selectTool("select");
    await editor.dragFrom(top!, { x: top!.x + 40, y: top!.y });

    expect(editor.canvasText()).toMatchObject({
      glyphs: [expect.anything(), { origin: { x: before.x + 40, y: before.y } }],
    });
  });
});

describe("text follows the shown location", () => {
  const editor = useTestEditor({ file: FONTS.mutatorSans, glyph: "A" });

  it("interpolates the text's advance between masters", async () => {
    editor.clickSource("LightCondensed");
    expect(editor.canvasText()).toMatchObject({ advance: 396 });
    editor.clickSource("BoldCondensed");
    expect(editor.canvasText()).toMatchObject({ advance: 740 });

    editor.setLocation({ wdth: 0, wght: 500 });

    expect(editor.canvasText()).toMatchObject({ advance: expect.closeTo(568) });
  });
});

describe("typed items resolve to glyphs", () => {
  const editor = useTestEditor(ABC);
  beforeEach(() => editor.selectTool("text"));

  it("shows a character through the font's Unicode mapping and follows a remap", async () => {
    editor.typeText("B");
    expect(editor.canvasText()).toMatchObject({
      glyphs: [expect.anything(), { name: "B", glyphId: expect.anything() }],
    });

    editor.setGlyphIdentity("B", "B", []);
    await editor.settle();

    expect(editor.canvasText()).toMatchObject({
      glyphs: [expect.anything(), { glyphId: null }],
    });
  });

  it("keeps a glyph picked by name, with no Unicode value, through a rename", async () => {
    await editor.addGlyph("a.alt", null);
    editor.pasteText("/a.alt");
    const picked = editor.canvasText()!.glyphs[1]!;
    expect(picked).toMatchObject({ name: "a.alt" });

    editor.setGlyphIdentity("a.alt", "a.ss01", []);
    await editor.settle();

    expect(editor.canvasText()).toMatchObject({
      glyphs: [expect.anything(), { glyphId: picked.glyphId, name: "a.ss01" }],
    });
  });

  it("reads a slash before a name the font lacks as literal text", async () => {
    editor.pasteText("/nope");

    expect(editor.canvasText()).toMatchObject({
      items: ["A", ..."/nope"].map((text) => ({ text })),
    });
  });
});
