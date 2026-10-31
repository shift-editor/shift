import { describe, expect, it, vi } from "vitest";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();

describe("the canvas reopens with its document", () => {
  it("restores the run text and the edited glyph", async () => {
    await editor.addGlyph("B", 66);
    editor.selectTool("text");
    editor.typeText("B");
    await editor.pressKey("Escape");
    const before = editor.canvasText();

    const reopened = await editor.reopen();

    expect(reopened.canvasText()).toMatchObject({
      items: before?.items,
      editedItemId: before?.editedItemId,
    });
    await expect(reopened.documentState()).resolves.toMatchObject({ dirty: false });
    await reopened.close();
  });

  it("reopens on the glyph opened last", async () => {
    await editor.addGlyph("B", 66);
    await editor.openGlyph("B");

    const reopened = await editor.reopen();

    expect(reopened.canvasText()).toMatchObject({ items: [{ text: "B" }], openGlyph: "B" });
    await reopened.close();
  });

  it("keeps selection and the text caret out of the document", async () => {
    editor.selectAll();
    editor.selectTool("text");
    expect(editor.canvasText()).not.toMatchObject({ caret: null });

    const reopened = await editor.reopen();

    expect(reopened.canvasText()).toMatchObject({ caret: null });
    expect(reopened.selectionIds()).toEqual([]);
    await reopened.close();
  });
});

describe("canvas writes", () => {
  it("are flushed into a save issued before their quiet period ends", async () => {
    await editor.save();
    editor.selectTool("text");
    editor.typeText("A");
    await expect(editor.documentState()).resolves.toMatchObject({ dirty: false });

    const reopened = await editor.reopen();

    expect(reopened.canvasText()).toMatchObject({ items: [{ text: "A" }, { text: "A" }] });
    await reopened.close();
  });

  it("mark the document dirty once the canvas is quiet", async () => {
    await editor.save();
    editor.selectTool("text");
    editor.typeText("A");

    await vi.waitFor(
      async () => {
        await expect(editor.documentState()).resolves.toMatchObject({ dirty: true });
      },
      { timeout: 3_000 },
    );
  });
});
