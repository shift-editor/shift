import { describe, expect, it } from "vitest";
import type { WorkspaceDocumentState } from "@shift/types";
import { DocumentViews } from "@/lib/workspace/documentViews";
import { ExportFolders } from "./ExportFolders";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
}

function document(documentId: string, saveTarget: string | null): WorkspaceDocumentState {
  return {
    workspaceId: `workspace-${documentId}`,
    sourceKind: saveTarget === null ? "untitled" : "document",
    documentId,
    saveTarget,
    canonicalPath: saveTarget,
    dirty: false,
    needsSaveAs: false,
  };
}

describe("export folders are remembered per document and target", () => {
  it("suggests fonts and sources folders beside a saved document, and none for an unsaved one", () => {
    const folders = new ExportFolders(new DocumentViews(memoryStorage));
    const saved = document("doc-1", "/type/Solenoid/Solenoid.shift");

    expect(folders.folder(saved, "variable")).toBe("/type/Solenoid/fonts");
    expect(folders.folder(saved, "static")).toBe("/type/Solenoid/fonts");
    expect(folders.folder(saved, "ufo")).toBe("/type/Solenoid/sources");
    expect(folders.folder(document("doc-2", null), "ufo")).toBeNull();
  });

  it("keeps a chosen folder for that target and document only, across sessions", () => {
    const storage = memoryStorage();
    const saved = document("doc-1", "/type/Solenoid/Solenoid.shift");
    const other = document("doc-2", "/type/Other/Other.shift");
    new ExportFolders(new DocumentViews(() => storage)).remember(saved, "ufo", "/repo/sources");

    const reopened = new ExportFolders(new DocumentViews(() => storage));

    expect(reopened.folder(saved, "ufo")).toBe("/repo/sources");
    expect(reopened.folder(saved, "variable")).toBe("/type/Solenoid/fonts");
    expect(reopened.folder(other, "ufo")).toBe("/type/Other/sources");
  });
});
