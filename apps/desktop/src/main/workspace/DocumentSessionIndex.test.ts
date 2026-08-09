import { describe, expect, it } from "vitest";
import type {
  WorkspaceDocumentState,
  WorkspaceDocumentIdentity,
} from "../../shared/workspace/protocol";
import { DocumentSessionIndex, type IndexedDocumentSession } from "./DocumentSessionIndex";
import type { FontSessionId } from "./FontSessionHost";

class DocumentChangeSource {
  readonly #listeners = new Set<(state: WorkspaceDocumentState | null) => void>();

  onDocumentChanged(listener: (state: WorkspaceDocumentState | null) => void): () => void {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  emit(state: WorkspaceDocumentState | null): void {
    for (const listener of this.#listeners) listener(state);
  }
}

describe("DocumentSessionIndex keeps one live session per DocumentId", () => {
  function session(workspaceId: FontSessionId): {
    source: DocumentChangeSource;
    session: IndexedDocumentSession;
  } {
    const source = new DocumentChangeSource();
    return {
      source,
      session: {
        workspaceId,
        workspaceProcess: source,
      },
    };
  }

  function identity(documentId: string, canonicalPath: string): WorkspaceDocumentIdentity {
    return { documentId, canonicalPath };
  }

  function documentState(
    workspaceId: FontSessionId,
    documentId: string,
    canonicalPath: string,
  ): WorkspaceDocumentState {
    return {
      workspaceId,
      sourceKind: "document",
      documentId,
      saveTarget: canonicalPath,
      canonicalPath,
      dirty: false,
      needsSaveAs: false,
    };
  }

  function untitledState(workspaceId: FontSessionId): WorkspaceDocumentState {
    return {
      workspaceId,
      sourceKind: "untitled",
      documentId: null,
      saveTarget: null,
      canonicalPath: null,
      dirty: false,
      needsSaveAs: true,
    };
  }

  it("indexes document state by DocumentId", () => {
    const index = new DocumentSessionIndex();
    const state = documentState("workspace_a", "document_a", "/font-a.shift");

    index.update("workspace_a", state);

    expect(index.workspaceIdForDocument(identity("document_a", "/font-a.shift"))).toBe(
      "workspace_a",
    );
    expect(index.workspaceIdForState(state)).toBe("workspace_a");
  });

  it("reindexes when Save As gives a session another DocumentId", () => {
    const index = new DocumentSessionIndex();

    index.update("workspace_a", documentState("workspace_a", "document_a", "/font-a.shift"));
    index.update("workspace_a", documentState("workspace_a", "document_b", "/font-b.shift"));

    expect(index.workspaceIdForDocument(identity("document_a", "/font-a.shift"))).toBeNull();
    expect(index.workspaceIdForDocument(identity("document_b", "/font-b.shift"))).toBe(
      "workspace_a",
    );
  });

  it("removes document ownership when a session stops being document-backed", () => {
    const index = new DocumentSessionIndex();

    index.update("workspace_a", documentState("workspace_a", "document_a", "/font-a.shift"));
    index.update("workspace_a", untitledState("workspace_a"));

    expect(index.workspaceIdForDocument(identity("document_a", "/font-a.shift"))).toBeNull();
  });

  it("tracks document changed events and untracks disposed sessions", () => {
    const index = new DocumentSessionIndex();
    const tracked = session("workspace_a");

    index.track(tracked.session);
    tracked.source.emit(documentState("workspace_a", "document_a", "/font-a.shift"));
    expect(index.workspaceIdForDocument(identity("document_a", "/font-a.shift"))).toBe(
      "workspace_a",
    );

    index.untrack("workspace_a");
    tracked.source.emit(documentState("workspace_a", "document_b", "/font-b.shift"));

    expect(index.workspaceIdForDocument(identity("document_a", "/font-a.shift"))).toBeNull();
    expect(index.workspaceIdForDocument(identity("document_b", "/font-b.shift"))).toBeNull();
  });

  it("rejects a second path carrying the same DocumentId", () => {
    const index = new DocumentSessionIndex();
    const state = documentState("workspace_a", "document_a", "/font-a.shift");

    index.update("workspace_a", state);

    expect(index.workspaceIdForDocument(identity("document_a", "/copy.shift"))).toBe("workspace_a");
    expect(() =>
      index.update("workspace_b", documentState("workspace_b", "document_a", "/copy.shift")),
    ).toThrow("Document session already registered");
  });

  it("keeps the previous DocumentId when a reindex is rejected", () => {
    const index = new DocumentSessionIndex();

    index.update("workspace_a", documentState("workspace_a", "document_a", "/font-a.shift"));
    index.update("workspace_b", documentState("workspace_b", "document_b", "/font-b.shift"));

    expect(() =>
      index.update("workspace_a", documentState("workspace_a", "document_b", "/font-b.shift")),
    ).toThrow("Document session already registered");

    expect(index.workspaceIdForDocument(identity("document_a", "/font-a.shift"))).toBe(
      "workspace_a",
    );
    expect(index.workspaceIdForDocument(identity("document_b", "/font-b.shift"))).toBe(
      "workspace_b",
    );
  });
});
