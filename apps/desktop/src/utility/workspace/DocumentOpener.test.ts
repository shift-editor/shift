import { createBridge, type ShiftBridge } from "@shift/bridge";
import { mintGlyphId, type GlyphName, type Unicode } from "@shift/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DocumentStorage } from "./DocumentStorage";
import { DocumentOpener } from "./DocumentOpener";
import { DocumentAddress } from "./types";

function addGlyph(bridge: ShiftBridge, name: string, unicode: number): void {
  bridge.workspace.apply(
    [
      {
        kind: "createGlyph",
        createGlyph: {
          glyphId: mintGlyphId(),
          name: name as GlyphName,
          unicodes: [unicode as Unicode],
        },
      },
    ],
    `Add ${name}`,
  );
}

describe("native document recovery allocations", () => {
  let root: string;
  let documentPath: string;
  let storage: DocumentStorage;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "shift-document-opener-"));
    documentPath = createDocument(root);
    storage = new DocumentStorage(path.join(root, "app-data"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reopens unsaved edits from the same document binding", () => {
    const first = openDocument(documentPath, storage);
    addGlyph(first.bridge, "B", 66);
    first.bridge.workspace.closeWorkspace();

    const reopened = openDocument(documentPath, storage);

    expect(reopened.workspaceId).toBe(first.workspaceId);
    expect(reopened.bridge.workspace.getGlyphs().map((glyph) => glyph.name)).toEqual(["A", "B"]);
    expect(canonicalGlyphNames(documentPath, root)).toEqual(["A"]);
    reopened.bridge.workspace.closeWorkspace();
  });

  it("replaces an exact binding whose recovery file is missing", () => {
    const first = openDocument(documentPath, storage);
    const firstWorkspacePath = path.dirname(first.workspace.recoveryPath);
    first.bridge.workspace.closeWorkspace();
    storage.deleteRecovery(first.workspace.recoveryPath);

    const reopened = openDocument(documentPath, storage);

    expect(reopened.workspaceId).not.toBe(first.workspaceId);
    expect(reopened.bridge.workspace.getGlyphs().map((glyph) => glyph.name)).toEqual(["A"]);
    expect(fs.existsSync(firstWorkspacePath)).toBe(false);
    reopened.bridge.workspace.closeWorkspace();
  });

  it("rebinds recovery when the same document moves to a new path", () => {
    const identity = createBridge().workspace.inspectDocument(documentPath);
    const first = openDocument(documentPath, storage);
    addGlyph(first.bridge, "B", 66);
    first.bridge.workspace.closeWorkspace();
    const movedPath = path.join(root, "Moved.shift");
    fs.renameSync(documentPath, movedPath);

    const moved = openDocument(movedPath, storage);

    expect(moved.workspaceId).toBe(first.workspaceId);
    expect(moved.bridge.workspace.getGlyphs().map((glyph) => glyph.name)).toEqual(["A", "B"]);
    expect(storage.documentBinding(DocumentAddress.fromIdentity(identity))).toBeNull();
    moved.bridge.workspace.closeWorkspace();
  });

  it("does not attach recovery to a raw copy while the original path exists", () => {
    const first = openDocument(documentPath, storage);
    addGlyph(first.bridge, "B", 66);
    first.bridge.workspace.closeWorkspace();
    const copyPath = path.join(root, "Copy.shift");
    fs.copyFileSync(documentPath, copyPath);

    const copied = openDocument(copyPath, storage);

    expect(copied.workspaceId).not.toBe(first.workspaceId);
    expect(copied.bridge.workspace.getGlyphs().map((glyph) => glyph.name)).toEqual(["A"]);
    copied.bridge.workspace.closeWorkspace();
  });

  it("refuses a recovery binding copied to another document identity", () => {
    const first = openDocument(documentPath, storage);
    addGlyph(first.bridge, "B", 66);
    first.bridge.workspace.closeWorkspace();
    const otherPath = createDocument(root, "Other.shift");
    const otherIdentity = createBridge().workspace.inspectDocument(otherPath);
    storage.writeDocumentBinding(DocumentAddress.fromIdentity(otherIdentity), first.workspace);

    expect(() => openDocument(otherPath, storage)).toThrow("recovery overlay belongs to document");
    expect(canonicalGlyphNames(otherPath, root)).toEqual(["A"]);
  });

  it("refuses a binding whose recovery path escapes its workspace", () => {
    const opened = openDocument(documentPath, storage);
    opened.bridge.workspace.closeWorkspace();
    corruptRecoveryPath(root, documentPath);

    expect(() => openDocument(documentPath, storage)).toThrow("workspace path mismatch");
    expect(canonicalGlyphNames(documentPath, root)).toEqual(["A"]);
  });

  it("lists saved and unsaved recoverable workspaces", () => {
    const saved = openDocument(documentPath, storage);
    addGlyph(saved.bridge, "B", 66);
    saved.bridge.workspace.closeWorkspace();

    const unsaved = storage.createWorkspace();
    const unsavedBridge = createBridge();
    unsavedBridge.workspace.createUntitledWorkspace(unsaved.storePath);
    unsavedBridge.workspace.setWorkspaceId(unsaved.workspaceId);
    addGlyph(unsavedBridge, "C", 67);
    unsavedBridge.workspace.closeWorkspace();

    expect(storage.listRecoveries()).toEqual([
      {
        kind: "saved",
        state: "recoverable",
        workspaceId: saved.workspaceId,
        documentId: createBridge().workspace.inspectDocument(documentPath).documentId,
        canonicalPath: fs.realpathSync(documentPath),
      },
      { kind: "unsaved", state: "recoverable", workspaceId: unsaved.workspaceId },
    ]);
  });

  it("rejects malformed recovery bindings during discovery", () => {
    const opened = openDocument(documentPath, storage);
    opened.bridge.workspace.closeWorkspace();
    corruptRecoveryPath(root, documentPath);

    expect(() => storage.listRecoveries()).toThrow("workspace path mismatch");
    expect(fs.existsSync(opened.workspace.recoveryPath)).toBe(true);
  });

  it("resumes a complete unsaved working store without a source path", () => {
    const unsaved = storage.createWorkspace();
    const first = createBridge();
    first.workspace.createUntitledWorkspace(unsaved.storePath);
    first.workspace.setWorkspaceId(unsaved.workspaceId);
    addGlyph(first, "A", 65);
    first.workspace.closeWorkspace();

    const resumed = createBridge();
    resumed.workspace.resumeWorkspace(unsaved.storePath);
    resumed.workspace.setWorkspaceId(unsaved.workspaceId);

    expect(resumed.workspace.getGlyphs().map((glyph) => glyph.name)).toEqual(["A"]);
    expect(resumed.workspace.documentState()).toMatchObject({
      sourceKind: "untitled",
      dirty: true,
      needsSaveAs: true,
    });
    resumed.workspace.closeWorkspace();
  });

  it("refuses a document replaced after identity inspection", () => {
    const bridge = createBridge();
    const identity = bridge.workspace.inspectDocument(documentPath);
    const replacementPath = createDocument(root, "Replacement.shift");
    fs.rmSync(documentPath);
    fs.renameSync(replacementPath, documentPath);

    expect(() => new DocumentOpener(bridge, storage).open(identity)).toThrow(
      "document changed during open",
    );
  });
});

function createDocument(root: string, fileName = "Font.shift"): string {
  const bridge = createBridge();
  const workspacePath = path.join(root, `${fileName}.working.sqlite`);
  const recoveryPath = path.join(root, `${fileName}.recovery.sqlite`);
  const outputPath = path.join(root, fileName);
  bridge.workspace.createUntitledWorkspace(workspacePath);
  bridge.workspace.setWorkspaceId(crypto.randomUUID());
  addGlyph(bridge, "A", 65);
  bridge.workspace.saveWorkspaceAsDocument(outputPath, recoveryPath);
  bridge.workspace.closeWorkspace();
  return outputPath;
}

function openDocument(
  documentPath: string,
  storage: DocumentStorage,
): {
  bridge: ShiftBridge;
  workspaceId: string;
  workspace: ReturnType<DocumentStorage["workspace"]>;
} {
  const bridge = createBridge();
  const identity = bridge.workspace.inspectDocument(documentPath);
  const opened = new DocumentOpener(bridge, storage).open(identity);
  return {
    bridge,
    workspaceId: opened.workspace.workspaceId,
    workspace: opened.workspace,
  };
}

function corruptRecoveryPath(root: string, invalidRecoveryPath: string): void {
  const bindingsRoot = path.join(root, "app-data", "bindings");
  const documentDirectory = fs.readdirSync(bindingsRoot)[0];
  if (!documentDirectory) throw new Error("document binding directory is missing");

  const bindingDirectory = path.join(bindingsRoot, documentDirectory);
  const bindingFile = fs.readdirSync(bindingDirectory)[0];
  if (!bindingFile) throw new Error("document binding file is missing");

  const bindingPath = path.join(bindingDirectory, bindingFile);
  const binding = JSON.parse(fs.readFileSync(bindingPath, "utf8")) as Record<string, unknown>;
  binding.recoveryPath = invalidRecoveryPath;
  fs.writeFileSync(bindingPath, JSON.stringify(binding));
}

function canonicalGlyphNames(documentPath: string, root: string): string[] {
  const bridge = createBridge();
  bridge.workspace.openDocument(documentPath, path.join(root, `${crypto.randomUUID()}.sqlite`));
  try {
    return bridge.workspace.getGlyphs().map((glyph) => glyph.name);
  } finally {
    bridge.workspace.closeWorkspace();
  }
}
