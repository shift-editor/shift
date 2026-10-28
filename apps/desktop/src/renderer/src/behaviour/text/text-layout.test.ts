import { afterEach, describe, expect, it } from "vitest";
import { NONSPACING_MARK_EDITOR_ADVANCE } from "@shift/editor/text";
import { triangle } from "@/testing/fixtures";
import { FONTS, startEditorWith } from "@/testing/fontFixture";
import type { EditorTestSurface } from "@/testing/surface";
import { openTestEditor } from "@/testing/TestEditor";

/** A new font's line height: ascender 800 less descender -200, with no line gap. */
const LINE_HEIGHT = 1000;

let editor: EditorTestSurface;
afterEach(() => editor.close());

/**
 * A font whose A (a triangle), B and C advance 500, 600 and 700, with the
 * canvas text `A` in Text mode and the caret after it.
 *
 * @remarks
 * The session is a preview, whose text is never shaped, so the text lays out
 * each glyph as typed, without the font's features.
 */
async function startWithABC(): Promise<EditorTestSurface> {
  const started = await startEditorWith({
    mode: "preview",
    glyphs: {
      A: { outline: { contours: [triangle([0, 0], [100, 0], [50, 100])] } },
      B: { unicode: 66, outline: { advance: 600 } },
      C: { unicode: 67, outline: { advance: 700 } },
    },
  });
  started.selectTool("text");
  return started;
}

/** The canvas text, which every test here has. */
function text() {
  const shown = editor.canvasText();
  if (!shown) throw new Error("the canvas shows no text");
  return shown;
}

describe("laying out typed text", () => {
  it("advances the text by the sum of its glyphs' advances", async () => {
    editor = await startWithABC();
    editor.typeText("BC");

    expect(text().glyphs.map(({ name, left, advance }) => ({ name, left, advance }))).toEqual([
      { name: "A", left: 0, advance: 500 },
      { name: "B", left: 500, advance: 600 },
      { name: "C", left: 1100, advance: 700 },
    ]);
    expect(text().advance).toBe(1800);
  });

  it("shows each glyph for the item it came from, drawn from its own origin", async () => {
    editor = await startWithABC();
    editor.typeText("B");
    const [a, b] = text().items;

    expect(text().glyphs).toMatchObject([
      { name: "A", itemIds: [a!.id], origin: { x: 0, y: 0 } },
      { name: "B", itemIds: [b!.id], origin: { x: 500, y: 0 } },
    ]);
  });

  it("shows nothing and advances nothing when every item is deleted", async () => {
    editor = await startWithABC();
    editor.deleteBackward();

    expect(text()).toMatchObject({ items: [], glyphs: [], advance: 0, baselines: [] });
  });

  it("starts a new line one line height below at each line break", async () => {
    editor = await startWithABC();
    editor.typeText("A\nB");
    const [, , linebreak, b] = text().items;

    expect(text().baselines).toEqual([0, -LINE_HEIGHT]);
    expect(text().glyphs.map(({ name, line }) => ({ name, line }))).toEqual([
      { name: "A", line: 0 },
      { name: "A", line: 0 },
      { name: "B", line: 1 },
    ]);
    expect(text().glyphs[2]).toMatchObject({ itemIds: [b!.id], origin: { x: 0, y: -LINE_HEIGHT } });
    expect(text().glyphs.flatMap(({ itemIds }) => itemIds)).not.toContain(linebreak!.id);
  });

  it("lays out an empty line for a line break with nothing after it", async () => {
    editor = await startWithABC();
    editor.deleteBackward();
    editor.typeText("\n");

    expect(text()).toMatchObject({ glyphs: [], advance: 0, baselines: [0, -LINE_HEIGHT] });
  });

  it("shows a character the font has no glyph for with no advance", async () => {
    editor = await startWithABC();
    editor.typeText("\u{10fffd}");

    expect(text().glyphs[1]).toMatchObject({ glyphId: null, advance: 0 });
  });

  it("places the caret before the glyph whose left half is clicked", async () => {
    editor = await startWithABC();
    editor.typeText("B");

    await editor.clickAt({ x: 500 + 600 / 4, y: 0 });

    expect(text().caret).toMatchObject({ position: 1, x: 500, y: 0 });
  });
});

describe("moving the caret through laid-out text", () => {
  it("steps one item at a time and stops at either end", async () => {
    editor = await startWithABC();
    editor.typeText("B");
    const position = () => text().caret?.position;

    editor.moveCaret(1);
    expect(position()).toBe(2);
    editor.moveCaret(-1);
    expect(position()).toBe(1);
    editor.moveCaret(-1);
    editor.moveCaret(-1);
    expect(position()).toBe(0);
  });

  it("steps from the end of a line to the start of the next", async () => {
    editor = await startWithABC();
    editor.typeText("\nB");
    editor.moveCaret(-1, "character");
    editor.moveCaret(-1, "character");
    editor.moveCaret(-1, "character");

    editor.moveCaret(1);
    expect(text().caret).toMatchObject({ position: 1, y: 0 });
    editor.moveCaret(1);
    expect(text().caret).toMatchObject({ position: 2, x: 0, y: -LINE_HEIGHT });
  });

  it("puts the caret on the empty line after a line break typed at the end", async () => {
    editor = await startWithABC();
    editor.typeText("\n");

    expect(text().caret).toMatchObject({ position: 2, x: 0, y: -LINE_HEIGHT });
  });

  it("puts the caret on the empty middle line between two line breaks", async () => {
    editor = await startWithABC();
    editor.deleteBackward();
    editor.typeText("\n\n");
    editor.moveCaret(-1);

    expect(text().caret).toMatchObject({ position: 1, x: 0, y: -LINE_HEIGHT });
  });
});

describe("nonspacing marks in typed text", () => {
  /** Adds a glyph with no advance, then reopens A in Text mode. */
  async function addZeroWidthGlyph(name: string, unicode: number | null = null): Promise<void> {
    await editor.addGlyph(name, unicode);
    await editor.openGlyph(name);
    editor.setAdvanceWidth(0);
    await editor.openGlyph("A");
    editor.selectTool("text");
  }

  // Glyph data reads `x.comb` as a suffixed `x`: a letter, though its name says `comb`.
  it("lays out a glyph named like a mark as spacing when its category is not a mark", async () => {
    editor = await startWithABC();
    await addZeroWidthGlyph("x.comb");

    editor.pasteText("/x.comb");

    expect(text().glyphs[1]).toMatchObject({
      name: "x.comb",
      advance: 0,
      left: 500,
      origin: { x: 500, y: 0 },
    });
  });

  // Glyph data reads `fatha-ar` as a nonspacing mark; neither name nor Unicode says so.
  it("gives a nonspacing mark a visible advance though its name does not look like one", async () => {
    editor = await startWithABC();
    await addZeroWidthGlyph("fatha-ar");

    editor.pasteText("/fatha-ar");

    expect(text().glyphs[1]).toMatchObject({
      name: "fatha-ar",
      advance: NONSPACING_MARK_EDITOR_ADVANCE,
    });
  });

  it("kerns a glyph named like a mark against its neighbour, but not a nonspacing mark", async () => {
    editor = await startWithABC();
    await addZeroWidthGlyph("x.comb");
    await addZeroWidthGlyph("fatha-ar");
    editor.setKerning("Regular", "A", "x.comb", -30);
    editor.setKerning("Regular", "A", "fatha-ar", -30);
    await editor.settle();

    editor.pasteText("/x.comb");
    expect(text().glyphs[0]!.kern).toBe(-30);

    editor.deleteBackward();
    editor.pasteText("/fatha-ar");
    expect(text().glyphs[0]!.kern).toBe(0);
  });

  it("shows a typed character once a glyph for it is added", async () => {
    editor = await startWithABC();
    editor.typeText("َ");
    expect(text().glyphs[1]).toMatchObject({ glyphId: null, advance: 0 });

    await editor.addGlyph("fatha-ar", 0x064e);

    expect(text().glyphs[1]).toMatchObject({ name: "fatha-ar", advance: 500 });
  });
});

describe("marks attach to their base's anchors", () => {
  // `aacute` has no anchors of its own: its `top` is `acutecomb`'s, copied in by propagation.
  it("attaches a mark to an anchor a composite takes from its components", async () => {
    editor = await openTestEditor(FONTS.anchorPropagation, "a");
    editor.selectTool("text");

    editor.pasteText("/aacute/acutecomb");
    await editor.settle();

    const [, base, mark] = text().glyphs;
    expect(base).toMatchObject({ name: "aacute", origin: { x: 500, y: 0 } });
    // acutecomb's `top` (100, 700) moved by its component offset (150, 0), less its `_top` (100, 500).
    expect(mark).toMatchObject({ name: "acutecomb", origin: { x: 650, y: 200 }, advance: 0 });
  });

  it("moves the mark with the anchor it sits on", async () => {
    editor = await openTestEditor(FONTS.anchorPropagation, "a");
    // `a`'s first anchor is `top`, where `tildecomb` sits.
    const [top] = await editor.anchors();
    editor.selectTool("text");
    editor.typeText("\u0303");
    await editor.pressKey("Escape");
    const before = text().glyphs[1]!.origin;

    editor.selectTool("select");
    await editor.dragFrom(top!, { x: top!.x + 40, y: top!.y });

    expect(text().glyphs[1]!.origin).toEqual({ x: before.x + 40, y: before.y });
  });
});

describe("text follows the shown location", () => {
  it("interpolates the text's advance between masters", async () => {
    editor = await openTestEditor(FONTS.mutatorSans, "A");
    editor.clickSource("LightCondensed");
    expect(text().advance).toBe(396);
    editor.clickSource("BoldCondensed");
    expect(text().advance).toBe(740);

    editor.setLocation({ wdth: 0, wght: 500 });

    expect(text().advance).toBeCloseTo(568);
  });
});

describe("typed items resolve to glyphs", () => {
  it("shows a character through the font's Unicode mapping and follows a remap", async () => {
    editor = await startWithABC();
    editor.typeText("B");
    expect(text().glyphs[1]).toMatchObject({ name: "B" });
    expect(text().glyphs[1]!.glyphId).not.toBeNull();

    editor.setGlyphIdentity("B", "B", []);
    await editor.settle();

    expect(text().glyphs[1]!.glyphId).toBeNull();
  });

  it("keeps a glyph picked by name, with no Unicode value, through a rename", async () => {
    editor = await startWithABC();
    await editor.addGlyph("a.alt", null);
    editor.pasteText("/a.alt");
    const picked = text().glyphs[1]!;
    expect(picked).toMatchObject({ name: "a.alt" });

    editor.setGlyphIdentity("a.alt", "a.ss01", []);
    await editor.settle();

    expect(text().glyphs[1]).toMatchObject({ glyphId: picked.glyphId, name: "a.ss01" });
  });

  it("reads a slash before a name the font lacks as literal text", async () => {
    editor = await startWithABC();

    editor.pasteText("/nope");

    expect(text().items.map((item) => item.text)).toEqual(["A", ..."/nope"]);
  });
});
