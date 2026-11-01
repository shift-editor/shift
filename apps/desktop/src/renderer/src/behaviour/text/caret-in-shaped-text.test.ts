import { beforeEach, describe, expect, it } from "vitest";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor({ file: FONTS.shapingTest, glyph: "f" });

// The canvas text starts as the open glyph, f; each test types over it.
beforeEach(() => {
  editor.selectTool("text");
  editor.deleteBackward();
});

/** The caret's position in the items and where it draws, after each of `moves`. */
function caretAfterEach(moves: readonly (() => void)[]): { position: number; x: number }[] {
  return moves.map((move) => {
    move();
    const { position, x } = editor.canvasText()!.caret!;
    return { position, x };
  });
}

describe("carets in right-to-left text", () => {
  // Three joined behs: fina at 0–450, medi at 450–850, init at 850–1250.
  beforeEach(async () => {
    editor.typeText("ببب");
    await editor.settle();
  });

  it("stands at the left edge after the text, and moves right on screen, back in reading order", () => {
    expect(editor.canvasText()).toMatchObject({ caret: { position: 3, x: 0 } });

    const right = () => editor.moveCaret(1);
    expect(caretAfterEach([right, right, right, right])).toEqual([
      { position: 2, x: 450 },
      { position: 1, x: 850 },
      { position: 0, x: 1250 },
      { position: 0, x: 1250 },
    ]);
  });

  it("lands on the nearest character boundary when clicked", async () => {
    await editor.clickTextAt({ x: 1200, y: 200 });
    expect(editor.canvasText()).toMatchObject({ caret: { position: 0, x: 1250 } });

    await editor.clickTextAt({ x: 100, y: 200 });
    expect(editor.canvasText()).toMatchObject({ caret: { position: 3, x: 0 } });
  });

  it("deletes backward in reading order, whichever way the caret last moved", () => {
    editor.moveCaret(1);
    const [first, , third] = editor.canvasText()!.items;

    editor.deleteBackward();

    expect(editor.canvasText()).toMatchObject({
      items: [{ id: first!.id }, { id: third!.id }],
      caret: { position: 1 },
    });
  });
});

describe("carets inside a ligature", () => {
  it("splits the ligature's advance between the characters it joins", async () => {
    editor.typeText("fi");
    await editor.settle();

    editor.moveCaret(-1);

    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ name: "f_i", advance: 550 }],
      caret: { position: 1, x: 275 },
    });
  });
});

describe("carets in mixed-direction text", () => {
  it("starts an Arabic paragraph at its right edge, past the English word inside it", async () => {
    editor.typeText("بب fi");
    await editor.settle();

    editor.moveCaret(1, "line");

    expect(editor.canvasText()).toMatchObject({ advance: 1650, caret: { position: 0, x: 1650 } });
  });

  it("moves only ever left on screen with Option-left through Arabic words inside English", async () => {
    editor.typeText("fi بب بب fi");
    await editor.settle();
    const start = editor.canvasText()!.caret!.x;

    const wordLeft = () => editor.moveCaret(-1, "word");
    const carets = caretAfterEach([wordLeft, wordLeft, wordLeft, wordLeft]);

    const xs = carets.map(({ x }) => x);
    expect(xs.every((x, press) => x < (xs[press - 1] ?? start))).toBe(true);
    // The first press lands on the left edge of the last "fi", the last on the first's.
    expect([carets[0], carets.at(-1)]).toEqual([
      { position: 9, x: 3000 },
      { position: 0, x: 0 },
    ]);
  });
});

describe("turning shaping off lays a run out as typed", () => {
  it("shows the typed glyphs at once, and undo shapes the run again", async () => {
    editor.typeText("fi");
    await editor.settle();
    expect(editor.canvasText()).toMatchObject({ glyphs: [{ name: "f_i" }] });

    editor.setTextShaping(false);
    expect(editor.canvasText()).toMatchObject({ glyphs: [{ name: "f" }, { name: "i" }] });

    await editor.undo();
    expect(editor.canvasText()).toMatchObject({ glyphs: [{ name: "f_i" }] });
  });
});
