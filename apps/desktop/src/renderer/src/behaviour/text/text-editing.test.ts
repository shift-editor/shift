import { beforeEach, describe, expect, it } from "vitest";
import { useTestEditor } from "@/testing/fontFixture";

describe("Text mode", () => {
  // The canvas text is the open glyph, A, edited in place.
  const editor = useTestEditor();
  beforeEach(() => editor.selectTool("text"));

  it("puts the caret after the edited glyph and stops editing it", () => {
    expect(editor.canvasText()).toMatchObject({ caret: { position: 1 }, editedItemId: null });
    expect(editor.toolState()).toEqual({ id: "text", state: "editing" });
    expect(editor.shownCursor()).toBe("text");
  });

  it("ends on Escape, hiding the caret and editing the glyph again", async () => {
    const [a] = editor.canvasText()!.items;

    await editor.pressKey("Escape");

    expect(editor.canvasText()).toMatchObject({ caret: null, editedItemId: a!.id });
    expect(editor.toolState()).toEqual({ id: "select", state: "ready" });
  });

  it("restores the caret and selection from the last visit", async () => {
    editor.typeText("AA");
    editor.moveCaret(-1, "character", true);
    const left = editor.canvasText()?.caret;

    await editor.pressKey("Escape");
    editor.selectTool("text");

    expect(editor.canvasText()).toMatchObject({ caret: left });
  });

  it("puts the caret after the edited glyph when the old caret's item is gone", async () => {
    editor.typeText("A");
    await editor.pressKey("Escape");
    await editor.undo();
    expect(editor.canvasText(), "undo outside Text mode does not show the caret").toMatchObject({
      caret: null,
    });

    editor.selectTool("text");

    expect(editor.canvasText()).toMatchObject({
      caret: { position: 1, selection: { start: 1, end: 1 } },
    });
  });

  it("types text, and undo and redo replay its items and caret", async () => {
    editor.typeText("A");
    const typed = editor.canvasText()!.items[1]!;
    expect(editor.canvasText()).toMatchObject({ caret: { position: 2 } });

    await editor.undo();
    expect(editor.canvasText()).toMatchObject({
      items: [expect.anything()],
      caret: { position: 1 },
    });

    await editor.redo();
    expect(editor.canvasText()).toMatchObject({
      items: [expect.anything(), typed],
      caret: { position: 2 },
    });
  });

  it("pushes the edited glyph right when typing before it", () => {
    const [a] = editor.canvasText()!.items;
    editor.moveCaret(-1);

    editor.typeText("A");

    expect(editor.canvasText()).toMatchObject({
      openItemId: a!.id,
      glyphs: [expect.anything(), { itemIds: [a!.id], left: 500 }],
    });
  });

  it("closes the edited glyph when its item is deleted, and undo opens it again", async () => {
    const [a] = editor.canvasText()!.items;

    editor.deleteBackward();
    expect(editor.canvasText()).toMatchObject({ items: [], openItemId: null });

    await editor.undo();
    expect(editor.canvasText()).toMatchObject({ items: [{ id: a!.id }], openItemId: a!.id });
  });

  it("edits no glyph on leaving after the edited glyph was deleted", async () => {
    editor.deleteBackward();

    await editor.pressKey("Escape");

    expect(editor.canvasText()).toMatchObject({ editedItemId: null, openItemId: null });
  });

  it("selects every item, line breaks included, and undo restores the caret", async () => {
    editor.typeText("\nA");
    const before = editor.canvasText()?.caret;

    editor.selectAllText();
    expect(editor.canvasText()).toMatchObject({ caret: { selection: { start: 0, end: 3 } } });

    await editor.undo();
    expect(editor.canvasText()).toMatchObject({ caret: before });
  });

  it("moves and deletes across a line break, and undo restores it", async () => {
    editor.typeText("\nA");
    editor.moveCaret(-1);
    expect(editor.canvasText()).toMatchObject({ caret: { position: 2 } });

    editor.deleteBackward();
    expect(editor.canvasText()).toMatchObject({ items: [{ text: "A" }, { text: "A" }] });

    await editor.undo();
    expect(editor.canvasText()).toMatchObject({
      items: [{ text: "A" }, { text: "\n" }, { text: "A" }],
      caret: { position: 2 },
    });
  });

  it("moves a line up by position on the line, and Shift extends the selection", () => {
    editor.typeText("\nA");

    editor.moveCaretLine(-1, true);

    expect(editor.canvasText()).toMatchObject({
      caret: { position: 1, selection: { start: 1, end: 3 } },
    });
  });

  it("keeps an item's identity when another item is typed before it", () => {
    editor.typeText("B");
    const b = editor.canvasText()!.items[1]!;
    editor.moveCaret(-1);
    editor.moveCaret(-1);

    editor.typeText("C");

    expect(editor.canvasText()).toMatchObject({ items: [{ text: "C" }, { text: "A" }, b] });
  });

  it("steps over a base and its combining mark as one character", () => {
    editor.typeText("éx");
    const end = editor.canvasText()!.caret!.position;

    editor.moveCaret(-1);
    editor.moveCaret(-1);

    expect(editor.canvasText()).toMatchObject({ caret: { position: end - 3 } });
  });

  it("deletes a combining mark alone with Backspace, and a whole cluster with Delete", () => {
    editor.typeText("é");
    editor.deleteBackward();
    expect(editor.canvasText()).toMatchObject({ items: [{ text: "A" }, { text: "e" }] });

    editor.typeText("́x");
    editor.moveCaret(-1);
    editor.moveCaret(-1);
    editor.deleteForward();
    expect(editor.canvasText()).toMatchObject({ items: [{ text: "A" }, { text: "x" }] });
  });

  it("moves by word with Option, skipping spaces and punctuation", () => {
    editor.typeText(" hello, world");
    const end = editor.canvasText()!.caret!.position;

    editor.moveCaret(-1, "word");
    expect(editor.canvasText()).toMatchObject({ caret: { position: end - 5 } });
    editor.moveCaret(-1, "word");
    expect(editor.canvasText()).toMatchObject({ caret: { position: end - 12 } });
    editor.moveCaret(1, "word");
    expect(editor.canvasText()).toMatchObject({ caret: { position: end - 7 } });
  });
});

describe("clicking and dragging in Text mode", () => {
  const editor = useTestEditor();
  beforeEach(() => editor.selectTool("text"));

  it("leaves the text and caret alone on a click on empty canvas", async () => {
    const before = editor.canvasText();

    await editor.clickAt({ x: 5000, y: 0 });

    expect(editor.canvasText()).toEqual(before);
  });

  it("places the caret where a glyph is clicked", async () => {
    editor.typeText("A");

    await editor.clickAt({ x: 500 * 1.75, y: 0 });
    expect(editor.canvasText()).toMatchObject({ caret: { position: 2 } });

    await editor.clickAt({ x: 500 * 0.25, y: 0 });
    expect(editor.canvasText()).toMatchObject({ caret: { position: 0 } });
  });

  it("extends the selection over the text a drag crosses", async () => {
    editor.typeText("A");

    await editor.dragFrom({ x: 100, y: 0 }, { x: 900, y: 0 });

    expect(editor.canvasText()).toMatchObject({ caret: { selection: { start: 0, end: 2 } } });
  });
});

describe("typing a glyph not loaded yet", () => {
  const setup = useTestEditor({ glyphs: { B: { unicode: 66, outline: { advance: 600 } } } });

  it("lays the glyph out at its advance once it loads", async () => {
    // The reopened document loads only A.
    const editor = await setup.reopen();
    try {
      editor.selectTool("text");
      editor.typeText("B");
      await editor.settle();

      expect(editor.canvasText()).toMatchObject({
        glyphs: [expect.anything(), { name: "B", left: 500, advance: 600 }],
        advance: 1100,
      });
    } finally {
      await editor.close();
    }
  });
});
