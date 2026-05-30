import { describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import { MUTATORSANS_DESIGNSPACE } from "@/testing/fixtures";
import { Document } from "./Document";

function testDocument() {
  const editor = new TestEditor();
  let filePath: string | null = "stale.ufo";
  let dirty = true;
  const document = new Document(editor, {
    createUntitledId: () => "untitled-1",
    setFilePath: (nextPath) => {
      filePath = nextPath;
    },
    clearDirty: () => {
      dirty = false;
    },
  });

  return {
    document,
    editor,
    get filePath() {
      return filePath;
    },
    get dirty() {
      return dirty;
    },
  };
}

describe("Document", () => {
  it("creates a loaded untitled font document with a default source", () => {
    const state = testDocument();

    state.document.createFont();

    expect(state.document.identity).toEqual({
      kind: "untitled",
      id: "untitled-1",
    });
    expect(state.editor.font.loaded).toBe(true);
    expect(state.editor.font.defaultSource.name).toBe("Regular");
    expect(state.filePath).toBeNull();
    expect(state.dirty).toBe(false);
  });

  it("opens a file-backed font document", () => {
    const state = testDocument();

    state.document.openFont(MUTATORSANS_DESIGNSPACE);

    expect(state.document.identity).toEqual({
      kind: "file",
      path: MUTATORSANS_DESIGNSPACE,
    });
    expect(state.editor.font.loaded).toBe(true);
    expect(state.editor.font.glyphHandleForName("A")).toEqual({
      name: "A",
      unicode: 65,
    });
    expect(state.filePath).toBe(MUTATORSANS_DESIGNSPACE);
    expect(state.dirty).toBe(false);
  });

  it("closes the current document", () => {
    const state = testDocument();
    state.document.createFont();

    state.document.close();

    expect(state.document.identity).toBeNull();
    expect(state.editor.font.loaded).toBe(false);
    expect(state.editor.font.sources).toEqual([]);
    expect(state.filePath).toBeNull();
  });

  it("requires a save path for untitled documents", async () => {
    const state = testDocument();
    state.document.createFont();

    await expect(state.document.saveFont()).rejects.toThrow(
      "Cannot save an untitled document without a file path",
    );
  });
});
