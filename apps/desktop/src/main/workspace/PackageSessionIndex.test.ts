import { describe, expect, it } from "vitest";
import type {
  WorkspaceDocumentState,
  WorkspacePackageIdentity,
} from "../../shared/workspace/protocol";
import { PackageSessionIndex, type IndexedPackageSession } from "./PackageSessionIndex";
import type { WorkspaceId } from "./WorkspaceSession";

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

describe("PackageSessionIndex keeps one live session per package address", () => {
  function session(workspaceId: WorkspaceId): {
    source: DocumentChangeSource;
    session: IndexedPackageSession;
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

  function identity(packageId: string, canonicalPath: string): WorkspacePackageIdentity {
    return {
      packageId,
      canonicalPath,
      fingerprint: "",
    };
  }

  function packageState(
    workspaceId: WorkspaceId,
    packageId: string,
    canonicalPath: string,
  ): WorkspaceDocumentState {
    return {
      documentId: workspaceId,
      sourceKind: "package",
      saveTarget: canonicalPath,
      packageId,
      canonicalPath,
      dirty: false,
      needsSaveAs: false,
    };
  }

  function untitledState(workspaceId: WorkspaceId): WorkspaceDocumentState {
    return {
      documentId: workspaceId,
      sourceKind: "untitled",
      saveTarget: null,
      packageId: null,
      canonicalPath: null,
      dirty: false,
      needsSaveAs: true,
    };
  }

  it("indexes a package-backed document state by package identity", () => {
    const index = new PackageSessionIndex();
    const state = packageState("workspace_a", "package_a", "/font-a.shift");

    index.update("workspace_a", state);

    expect(index.workspaceIdForPackage(identity("package_a", "/font-a.shift"))).toBe("workspace_a");
    expect(index.workspaceIdForState(state)).toBe("workspace_a");
  });

  it("reindexes when a session moves to another package address", () => {
    const index = new PackageSessionIndex();

    index.update("workspace_a", packageState("workspace_a", "package_a", "/font-a.shift"));
    index.update("workspace_a", packageState("workspace_a", "package_b", "/font-b.shift"));

    expect(index.workspaceIdForPackage(identity("package_a", "/font-a.shift"))).toBeNull();
    expect(index.workspaceIdForPackage(identity("package_b", "/font-b.shift"))).toBe("workspace_a");
  });

  it("removes package ownership when a session stops being package-backed", () => {
    const index = new PackageSessionIndex();

    index.update("workspace_a", packageState("workspace_a", "package_a", "/font-a.shift"));
    index.update("workspace_a", untitledState("workspace_a"));

    expect(index.workspaceIdForPackage(identity("package_a", "/font-a.shift"))).toBeNull();
  });

  it("tracks document changed events and untracks disposed sessions", () => {
    const index = new PackageSessionIndex();
    const tracked = session("workspace_a");

    index.track(tracked.session);
    tracked.source.emit(packageState("workspace_a", "package_a", "/font-a.shift"));
    expect(index.workspaceIdForPackage(identity("package_a", "/font-a.shift"))).toBe("workspace_a");

    index.untrack("workspace_a");
    tracked.source.emit(packageState("workspace_a", "package_b", "/font-b.shift"));

    expect(index.workspaceIdForPackage(identity("package_a", "/font-a.shift"))).toBeNull();
    expect(index.workspaceIdForPackage(identity("package_b", "/font-b.shift"))).toBeNull();
  });

  it("rejects two live sessions for one package address", () => {
    const index = new PackageSessionIndex();
    const state = packageState("workspace_a", "package_a", "/font-a.shift");

    index.update("workspace_a", state);

    expect(() =>
      index.update("workspace_b", packageState("workspace_b", "package_a", "/font-a.shift")),
    ).toThrow("Package session already registered");
  });

  it("keeps the previous package key when a reindex is rejected", () => {
    const index = new PackageSessionIndex();

    index.update("workspace_a", packageState("workspace_a", "package_a", "/font-a.shift"));
    index.update("workspace_b", packageState("workspace_b", "package_b", "/font-b.shift"));

    expect(() =>
      index.update("workspace_a", packageState("workspace_a", "package_b", "/font-b.shift")),
    ).toThrow("Package session already registered");

    expect(index.workspaceIdForPackage(identity("package_a", "/font-a.shift"))).toBe("workspace_a");
    expect(index.workspaceIdForPackage(identity("package_b", "/font-b.shift"))).toBe("workspace_b");
  });
});
