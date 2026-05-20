import { describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import { MUTATORSANS_DESIGNSPACE } from "@/testing/fixtures";
import { Document, type DocumentPersistence } from "./Document";

class InMemoryDocumentPersistence implements DocumentPersistence {
  currentDocId: string | null = null;
  currentPath: string | null = null;

  closeDocument(): void {
    this.currentDocId = null;
    this.currentPath = null;
  }

  openDocument(filePath: string): void {
    this.currentPath = filePath;
    this.currentDocId = `file:${filePath}`;
  }

  openUntitledDocument(docId: string): void {
    this.currentDocId = docId;
    this.currentPath = null;
  }

  onDocumentPathChanged(filePath: string | null): void {
    this.currentPath = filePath;
    if (filePath) this.currentDocId ??= `file:${filePath}`;
  }

  flushNow(): void {}
}

function testDocument() {
  const editor = new TestEditor();
  const persistence = new InMemoryDocumentPersistence();
  let filePath: string | null = "stale.ufo";
  let dirty = true;
  const document = new Document(editor, {
    persistence,
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
    persistence,
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
    expect(state.persistence.currentDocId).toBe("untitled-1");
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
    expect(state.persistence.currentPath).toBe(MUTATORSANS_DESIGNSPACE);
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
    expect(state.persistence.currentDocId).toBeNull();
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
