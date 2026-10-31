import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startEmptyMemorySession } from "../../testing/emptyMemorySession";
import type { MemoryFontSession } from "../../types/fontSession";
import { effect } from "../signals";
import type { Editor } from "../editor/Editor";

describe("Pages", () => {
  let session: MemoryFontSession;
  let editor: Editor;

  beforeEach(() => {
    session = startEmptyMemorySession();
    editor = session.editor;
  });
  afterEach(() => session.dispose());

  const pageNames = () => editor.pages.list.map((page) => page.name);

  it("publishes the list and the shown page to reactive readers", () => {
    const shownAtStart = editor.scene.shownPageIdCell.peek();
    const seen: string[][] = [];
    const shown: (string | null)[] = [];
    const listReader = effect(() => {
      seen.push(editor.pages.listCell.value.map((page) => page.name));
    });
    const activeReader = effect(() => {
      shown.push(editor.scene.shownPageIdCell.value);
    });

    const second = editor.pages.create();
    editor.history.capture("Select", () => editor.selection.clear());
    editor.pages.activate(second.id);
    listReader.dispose();
    activeReader.dispose();

    expect(seen).toEqual([["Page 1"], ["Page 1", "Page 2"]]);
    expect(shown).toEqual([shownAtStart, second.id]);
  });

  it("moves a page by writing only its own index key", () => {
    const pages = [editor.pages.list[0]!, editor.pages.create("B"), editor.pages.create("C")];
    const written: string[] = [];
    const before = new Map(pages.map((page) => [page.id, page.index]));

    editor.pages.move(pages[2]!.id, 0);
    for (const page of editor.pages.list) {
      if (before.get(page.id) !== page.index) written.push(page.name);
    }

    expect(pageNames()).toEqual(["C", "Page 1", "B"]);
    expect(written).toEqual(["C"]);
  });
});
