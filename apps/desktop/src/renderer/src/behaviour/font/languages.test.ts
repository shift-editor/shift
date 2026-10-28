import { describe, expect, it } from "vitest";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();

describe("tracking the font's languages", () => {
  it("tracks no languages in a new font", () => {
    expect(editor.languages()).toBeNull();
  });

  it("sets the list as one undoable step", async () => {
    editor.setLanguages(["eng-latin", "cmn-chinese"]);
    await editor.settle();
    expect(editor.languages()).toEqual(["eng-latin", "cmn-chinese"]);

    editor.setLanguages([]);
    await editor.settle();
    expect(editor.languages()).toEqual([]);

    await editor.undo();
    expect(editor.languages()).toEqual(["eng-latin", "cmn-chinese"]);
    await editor.undo();
    expect(editor.languages()).toBeNull();
    await editor.redo();
    expect(editor.languages()).toEqual(["eng-latin", "cmn-chinese"]);
  });

  it("keeps the list when the document is saved and reopened", async () => {
    editor.setLanguages(["eng-latin", "fra-latin"]);
    await editor.settle();

    const reopened = await editor.reopen();
    try {
      expect(reopened.languages()).toEqual(["eng-latin", "fra-latin"]);
    } finally {
      await reopened.close();
    }
  });
});
