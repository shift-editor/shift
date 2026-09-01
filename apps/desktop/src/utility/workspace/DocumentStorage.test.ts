import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocumentStorage } from "./DocumentStorage";
import { DocumentAddress } from "./types";

describe("document storage pruning preserves recoverable work", () => {
  let testRoot: string;
  let storageRoot: string;
  let storage: DocumentStorage;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shift-document-storage-"));
    storageRoot = path.join(testRoot, "app-data");
    storage = new DocumentStorage(storageRoot);
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it("removes empty workspaces, orphaned sidecars, and stale bindings", () => {
    const orphan = createWorkspaceFile("orphan", "recovery.sqlite-wal");
    const stale = storage.workspace("stale");
    fs.mkdirSync(path.dirname(stale.storePath), { recursive: true });
    storage.writeDocumentBinding(new DocumentAddress("document_stale", "/tmp/Stale.shift"), stale);

    storage.pruneOrphanedStorage();

    expect(fs.existsSync(path.dirname(orphan.storePath))).toBe(false);
    expect(fs.existsSync(path.dirname(stale.storePath))).toBe(false);
    expect(storage.listDocumentBindings("document_stale")).toEqual([]);
  });

  it("makes a bound working store discoverable when its recovery is missing", () => {
    const working = createWorkspaceFile("interrupted", "document.sqlite");
    storage.writeDocumentBinding(
      new DocumentAddress("document_interrupted", "/tmp/Interrupted.shift"),
      working,
    );

    storage.pruneOrphanedStorage();

    expect(storage.listDocumentBindings("document_interrupted")).toEqual([]);
    expect(storage.listRecoveries()).toEqual([
      { kind: "unsaved", state: "recoverable", workspaceId: "interrupted" },
    ]);
  });

  it("retains working stores and recovery overlays", () => {
    const working = createWorkspaceFile("working", "document.sqlite");
    const saved = createWorkspaceFile("saved", "recovery.sqlite");
    storage.writeDocumentBinding(new DocumentAddress("document_saved", "/tmp/Saved.shift"), saved);

    storage.pruneOrphanedStorage();

    expect(fs.existsSync(working.storePath)).toBe(true);
    expect(fs.existsSync(saved.recoveryPath)).toBe(true);
    expect(storage.listDocumentBindings("document_saved")).toHaveLength(1);
  });

  it("retains malformed bindings and unknown workspace artifacts", () => {
    const invalidBinding = path.join(storageRoot, "bindings", "document_invalid", "bad.json");
    fs.mkdirSync(path.dirname(invalidBinding), { recursive: true });
    fs.writeFileSync(invalidBinding, "not json");
    const invalidWorkspace = createWorkspaceFile("invalid", "unknown.bin");

    storage.pruneOrphanedStorage();

    expect(fs.existsSync(invalidBinding)).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(invalidWorkspace.storePath), "unknown.bin"))).toBe(
      true,
    );
  });

  function createWorkspaceFile(workspaceId: string, name: string) {
    const workspace = storage.workspace(workspaceId);
    const workspacePath = path.dirname(workspace.storePath);
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.writeFileSync(path.join(workspacePath, name), "state");
    return workspace;
  }
});
