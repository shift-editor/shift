import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startEditorWith } from "@/testing/fontFixture";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";

let editor: EditorTestSurface;
afterEach(() => editor.close());

/** The canvas text, which every test here has. */
function text() {
  const shown = editor.canvasText();
  if (!shown) throw new Error("the canvas shows no text");
  return shown;
}

const caret = () => text().caret;
const itemTexts = () => text().items.map((item) => item.text);

describe("Text mode", () => {
  // The canvas text is the open glyph, A, edited in place.
  beforeEach(async () => {
    editor = await startTestEditor();
    editor.selectTool("text");
  });

  it("puts the caret after the edited glyph and stops editing it", () => {
    expect(caret()).toMatchObject({ position: 1 });
    expect(text().editedItemId).toBeNull();
    expect(editor.toolState()).toEqual({ id: "text", state: "editing" });
    expect(editor.shownCursor()).toBe("text");
  });

  it("ends on Escape, hiding the caret and editing the glyph again", async () => {
    const [a] = text().items;

    await editor.pressKey("Escape");

    expect(caret()).toBeNull();
    expect(text().editedItemId).toBe(a!.id);
    expect(editor.toolState()).toEqual({ id: "select", state: "ready" });
  });

  it("restores the caret and selection from the last visit", async () => {
    editor.typeText("AA");
    editor.moveCaret(-1, "character", true);
    const left = caret();

    await editor.pressKey("Escape");
    editor.selectTool("text");

    expect(caret()).toEqual(left);
  });

  it("puts the caret after the edited glyph when the old caret's item is gone", async () => {
    editor.typeText("A");
    await editor.pressKey("Escape");
    await editor.undo();
    expect(caret(), "undo outside Text mode does not show the caret").toBeNull();

    editor.selectTool("text");

    expect(caret()).toMatchObject({ position: 1, selection: { start: 1, end: 1 } });
  });

  it("types text, and undo and redo replay its items and caret", async () => {
    editor.typeText("A");
    const typed = text().items[1]!;
    expect(caret()).toMatchObject({ position: 2 });

    await editor.undo();
    expect(text().items).toHaveLength(1);
    expect(caret()).toMatchObject({ position: 1 });

    await editor.redo();
    expect(text().items[1]).toEqual(typed);
    expect(caret()).toMatchObject({ position: 2 });
  });

  it("pushes the edited glyph right when typing before it", () => {
    const [a] = text().items;
    editor.moveCaret(-1);

    editor.typeText("A");

    expect(text().openItemId).toBe(a!.id);
    expect(text().glyphs[1]).toMatchObject({ itemIds: [a!.id], left: 500 });
  });

  it("closes the edited glyph when its item is deleted, and undo opens it again", async () => {
    const [a] = text().items;

    editor.deleteBackward();
    expect(text().items).toEqual([]);
    expect(text().openItemId).toBeNull();

    await editor.undo();
    expect(text().items[0]?.id).toBe(a!.id);
    expect(text().openItemId).toBe(a!.id);
  });

  it("edits no glyph on leaving after the edited glyph was deleted", async () => {
    editor.deleteBackward();

    await editor.pressKey("Escape");

    expect(text().editedItemId).toBeNull();
    expect(text().openItemId).toBeNull();
  });

  it("selects every item, line breaks included, and undo restores the caret", async () => {
    editor.typeText("\nA");
    const before = caret();

    editor.selectAllText();
    expect(caret()?.selection).toEqual({ start: 0, end: 3 });

    await editor.undo();
    expect(caret()).toEqual(before);
  });

  it("moves and deletes across a line break, and undo restores it", async () => {
    editor.typeText("\nA");
    editor.moveCaret(-1);
    expect(caret()).toMatchObject({ position: 2 });

    editor.deleteBackward();
    expect(itemTexts()).toEqual(["A", "A"]);

    await editor.undo();
    expect(itemTexts()).toEqual(["A", "\n", "A"]);
    expect(caret()).toMatchObject({ position: 2 });
  });

  it("moves a line up by position on the line, and Shift extends the selection", () => {
    editor.typeText("\nA");

    editor.moveCaretLine(-1, true);

    expect(caret()).toMatchObject({ position: 1, selection: { start: 1, end: 3 } });
  });

  it("keeps an item's identity when another item is typed before it", () => {
    editor.typeText("B");
    const b = text().items[1]!;
    editor.moveCaret(-1);
    editor.moveCaret(-1);

    editor.typeText("C");

    expect(text().items[2]).toEqual(b);
  });

  it("steps over a base and its combining mark as one character", () => {
    editor.typeText("éx");
    const end = caret()!.position;

    editor.moveCaret(-1);
    editor.moveCaret(-1);

    expect(caret()?.position).toBe(end - 3);
  });

  it("deletes a combining mark alone with Backspace, and a whole cluster with Delete", () => {
    editor.typeText("é");
    editor.deleteBackward();
    expect(itemTexts()).toEqual(["A", "e"]);

    editor.typeText("́x");
    editor.moveCaret(-1);
    editor.moveCaret(-1);
    editor.deleteForward();
    expect(itemTexts()).toEqual(["A", "x"]);
  });

  it("moves by word with Option, skipping spaces and punctuation", () => {
    editor.typeText(" hello, world");
    const end = caret()!.position;

    editor.moveCaret(-1, "word");
    expect(caret()?.position).toBe(end - 5);
    editor.moveCaret(-1, "word");
    expect(caret()?.position).toBe(end - 12);
    editor.moveCaret(1, "word");
    expect(caret()?.position).toBe(end - 7);
  });
});

describe("clicking and dragging in Text mode", () => {
  beforeEach(async () => {
    editor = await startTestEditor();
    editor.selectTool("text");
  });

  it("leaves the text and caret alone on a click on empty canvas", async () => {
    const before = text();

    await editor.clickAt({ x: 5000, y: 0 });

    expect(text()).toEqual(before);
  });

  it("places the caret where a glyph is clicked", async () => {
    editor.typeText("A");

    await editor.clickAt({ x: 500 * 1.75, y: 0 });
    expect(caret()).toMatchObject({ position: 2 });

    await editor.clickAt({ x: 500 * 0.25, y: 0 });
    expect(caret()).toMatchObject({ position: 0 });
  });

  it("extends the selection over the text a drag crosses", async () => {
    editor.typeText("A");

    await editor.dragFrom({ x: 100, y: 0 }, { x: 900, y: 0 });

    expect(caret()?.selection).toEqual({ start: 0, end: 2 });
  });
});

describe("typing a glyph not loaded yet", () => {
  it("lays the glyph out at its advance once it loads", async () => {
    const setup = await startEditorWith({
      glyphs: { B: { unicode: 66, outline: { advance: 600 } } },
    });
    // The reopened document loads only A.
    editor = await setup.reopen();
    await setup.close();

    editor.selectTool("text");
    editor.typeText("B");
    await editor.settle();

    expect(text().glyphs[1]).toMatchObject({ name: "B", left: 500, advance: 600 });
    expect(text().advance).toBe(1100);
  });
});
