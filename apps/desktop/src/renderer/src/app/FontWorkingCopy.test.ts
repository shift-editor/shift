import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestEditor } from "@/testing/TestEditor";
import { MUTATORSANS_DESIGNSPACE } from "@/testing/fixtures";
import { FontWorkingCopy, type DocumentPersistence } from "./FontWorkingCopy";

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

function testWorkingCopy() {
  const editor = new TestEditor();
  const persistence = new InMemoryDocumentPersistence();
  let nativeFilePath: string | null = "stale.ufo";
  let nativeDirty = true;
  const workingCopy = new FontWorkingCopy(editor, {
    persistence,
    createUntitledId: () => "untitled-1",
    setNativeFilePath: (nextPath) => {
      nativeFilePath = nextPath;
    },
    setNativeDirty: (nextDirty) => {
      nativeDirty = nextDirty;
    },
  });

  return {
    workingCopy,
    editor,
    persistence,
    get nativeFilePath() {
      return nativeFilePath;
    },
    get nativeDirty() {
      return nativeDirty;
    },
  };
}

describe("font document working-copy lifecycle", () => {
  it("creates a loaded untitled font document with a default source", () => {
    const state = testWorkingCopy();

    state.workingCopy.createFont();

    expect(state.workingCopy.identity).toEqual({
      kind: "untitled",
      id: "untitled-1",
    });
    expect(state.editor.font.loaded).toBe(true);
    expect(state.editor.font.defaultSource.name).toBe("Regular");
    expect(state.persistence.currentDocId).toBe("untitled-1");
    expect(state.workingCopy.filePath).toBeNull();
    expect(state.workingCopy.dirty).toBe(false);
    expect(state.nativeFilePath).toBeNull();
    expect(state.nativeDirty).toBe(false);
  });

  it("opens a file-backed font document", () => {
    const state = testWorkingCopy();

    state.workingCopy.openFont(MUTATORSANS_DESIGNSPACE);

    expect(state.workingCopy.identity).toEqual({
      kind: "file",
      path: MUTATORSANS_DESIGNSPACE,
    });
    expect(state.editor.font.loaded).toBe(true);
    expect(state.editor.font.glyphHandleForName("A")).toEqual({
      name: "A",
      unicode: 65,
    });
    expect(state.persistence.currentPath).toBe(MUTATORSANS_DESIGNSPACE);
    expect(state.workingCopy.filePath).toBe(MUTATORSANS_DESIGNSPACE);
    expect(state.workingCopy.dirty).toBe(false);
    expect(state.nativeFilePath).toBe(MUTATORSANS_DESIGNSPACE);
    expect(state.nativeDirty).toBe(false);
  });

  it("closes the current document", () => {
    const state = testWorkingCopy();
    state.workingCopy.createFont();

    state.workingCopy.close();

    expect(state.workingCopy.identity).toBeNull();
    expect(state.editor.font.loaded).toBe(false);
    expect(state.editor.font.sources).toEqual([]);
    expect(state.persistence.currentDocId).toBeNull();
    expect(state.workingCopy.filePath).toBeNull();
    expect(state.workingCopy.dirty).toBe(false);
  });

  it("requires a save path for untitled documents", async () => {
    const state = testWorkingCopy();
    state.workingCopy.createFont();

    await expect(state.workingCopy.saveFont()).rejects.toThrow(
      "Cannot save an untitled document without a file path",
    );
  });

  it("derives dirty state from live and saved revisions", async () => {
    const state = testWorkingCopy();
    const tempDir = mkdtempSync(join(tmpdir(), "shift-working-copy-"));
    const savePath = join(tempDir, "Saved.ufo");

    try {
      state.workingCopy.createFont();
      const initialRevision = state.workingCopy.currentRevision;

      state.workingCopy.commitMutation(() => state.editor.createGlyph("newGlyph"));

      expect(state.workingCopy.currentRevision).toBeGreaterThan(initialRevision);
      expect(state.workingCopy.savedRevision).toBe(initialRevision);
      expect(state.workingCopy.dirty).toBe(true);
      expect(state.nativeDirty).toBe(true);

      await state.workingCopy.saveFont(savePath);

      expect(state.workingCopy.savedRevision).toBe(state.workingCopy.currentRevision);
      expect(state.workingCopy.dirty).toBe(false);
      expect(state.nativeDirty).toBe(false);
      expect(state.nativeFilePath).toBe(savePath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps dirty true when a newer edit lands during an async save", async () => {
    const state = testWorkingCopy();
    const tempDir = mkdtempSync(join(tmpdir(), "shift-working-copy-race-"));
    const savePath = join(tempDir, "Race.ufo");

    try {
      state.workingCopy.createFont();
      state.workingCopy.commitMutation(() => state.editor.createGlyph("newGlyph"));

      const save = state.workingCopy.saveFont(savePath);
      state.workingCopy.commitMutation(() => state.editor.createGlyph("newGlyph"));
      await save;

      expect(state.workingCopy.savedRevision).toBeLessThan(state.workingCopy.currentRevision);
      expect(state.workingCopy.dirty).toBe(true);
      expect(state.nativeDirty).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
