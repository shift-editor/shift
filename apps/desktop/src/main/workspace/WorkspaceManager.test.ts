import { describe, expect, it } from "vitest";
import type { WorkspaceDocumentState } from "../../shared/workspace/protocol";
import type { WorkspaceProcess } from "./WorkspaceProcess";
import type { WorkspaceSession } from "./WorkspaceSession";
import { WorkspaceManager } from "./WorkspaceManager";

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

describe("WorkspaceManager package session cleanup", () => {
  function packageState(
    documentId: string,
    packageId: string,
    canonicalPath: string,
  ): WorkspaceDocumentState {
    return {
      documentId,
      sourceKind: "package",
      saveTarget: canonicalPath,
      packageId,
      canonicalPath,
      dirty: false,
      needsSaveAs: false,
    };
  }

  function session(workspaceId: string): {
    source: DocumentChangeSource;
    session: WorkspaceSession;
  } {
    const source = new DocumentChangeSource();
    return {
      source,
      session: {
        workspaceId,
        workspaceProcess: source as Pick<WorkspaceProcess, "onDocumentChanged">,
        document: {
          acceptState() {},
        },
        windows: new Set(),
        dispose() {},
      } as unknown as WorkspaceSession,
    };
  }

  it("unregister removes package ownership and ignores later document events", () => {
    const manager = new WorkspaceManager({
      documentsRoot: () => "/tmp",
      applicationName: () => "Shift",
    });
    const tracked = session("workspace_a");

    manager.register(tracked.session);
    tracked.source.emit(packageState("workspace_a", "package_a", "/font-a.shift"));
    manager.unregister("workspace_a");
    tracked.source.emit(packageState("workspace_a", "package_b", "/font-b.shift"));
    const replacement = session("workspace_b");

    manager.register(replacement.session);
    expect(() =>
      replacement.source.emit(packageState("workspace_b", "package_b", "/font-b.shift")),
    ).not.toThrow();

    expect(manager.list().map((session) => session.workspaceId)).toEqual(["workspace_b"]);
  });

  it("does not keep duplicate registered sessions after unregister", () => {
    const manager = new WorkspaceManager({
      documentsRoot: () => "/tmp",
      applicationName: () => "Shift",
    });
    const first = session("workspace_a");
    const second = session("workspace_a");

    manager.register(first.session);
    expect(() => manager.register(second.session)).toThrow("Workspace session already registered");

    manager.unregister("workspace_a");
    manager.register(second.session);

    expect(manager.list().map((session) => session.workspaceId)).toEqual(["workspace_a"]);
  });
});
