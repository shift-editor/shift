import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mintNodeId } from "@shift/types";
import { startEmptyMemorySession } from "../../testing/emptyMemorySession";
import type { MemoryFontSession } from "../../types/fontSession";
import type { TextRunNode } from "../../types/node";
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
    const shownAtStart = editor.pages.activeCell.peek();
    const seen: string[][] = [];
    const shown: (string | null)[] = [];
    const listReader = effect(() => {
      seen.push(editor.pages.listCell.value.map((page) => page.name));
    });
    const activeReader = effect(() => {
      shown.push(editor.pages.activeCell.value);
    });

    const second = editor.pages.create();
    editor.history.capture("Select", () => editor.selection.clear());
    editor.pages.activate(second.id);
    listReader.dispose();
    activeReader.dispose();

    expect(seen).toEqual([["Page 1"], ["Page 1", "Page 2"]]);
    expect(shown).toEqual([shownAtStart, second.id]);
  });

  it("puts nodes written without a page onto Page 1", () => {
    const loose: TextRunNode = {
      type: "node",
      kind: "textRun",
      id: mintNodeId(),
      parentId: null,
      index: "a0",
      runId: editor.text.createRun([]).id,
      size: 1000,
      position: { x: 0, y: 0 },
    };

    editor.scene.setNodes([loose]);

    const page = editor.pages.list[0];
    expect(pageNames()).toEqual(["Page 1"]);
    expect(editor.scene.node(loose.id)?.parentId).toBe(page?.id);
    expect(editor.scene.first("textRun")?.id).toBe(loose.id);
  });
});
