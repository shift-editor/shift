import type {
  WorkspaceDocumentState,
  WorkspacePackageIdentity,
} from "../../shared/workspace/protocol";
import type { WorkspaceProcess } from "./WorkspaceProcess";
import type { WorkspaceId } from "./WorkspaceSession";

export type IndexedPackageSession = {
  readonly workspaceId: WorkspaceId;
  readonly workspaceProcess: Pick<WorkspaceProcess, "onDocumentChanged">;
};

/**
 * Indexes live workspace sessions by package address.
 *
 * @remarks
 * This is main-process live-session bookkeeping. It enforces that at most one
 * live {@link WorkspaceId} owns a package address, and it follows document
 * state changes because Save As can move a session between package addresses.
 */
export class PackageSessionIndex {
  readonly #workspaceIdByPackageKey = new Map<string, WorkspaceId>();
  readonly #packageKeyByWorkspaceId = new Map<WorkspaceId, string>();
  readonly #unlistenByWorkspaceId = new Map<WorkspaceId, () => void>();

  /**
   * Tracks document state changes for one live workspace session.
   *
   * @param session - live workspace session with a document-change source.
   * @throws {Error} when the session is already tracked.
   */
  track(session: IndexedPackageSession): void {
    if (this.#unlistenByWorkspaceId.has(session.workspaceId)) {
      throw new Error(`Package session already tracked: ${session.workspaceId}`);
    }

    this.#unlistenByWorkspaceId.set(
      session.workspaceId,
      session.workspaceProcess.onDocumentChanged((state) => {
        this.update(session.workspaceId, state);
      }),
    );
  }

  /**
   * Stops tracking a live workspace session and removes its package ownership.
   *
   * @param workspaceId - session identity being unregistered.
   */
  untrack(workspaceId: WorkspaceId): void {
    this.#remove(workspaceId);

    const unlisten = this.#unlistenByWorkspaceId.get(workspaceId);
    if (unlisten) unlisten();
    this.#unlistenByWorkspaceId.delete(workspaceId);
  }

  /**
   * Updates the package address owned by a workspace session.
   *
   * @param workspaceId - live workspace session receiving document state.
   * @param state - latest document state; null clears package ownership.
   * @throws {Error} when another live session already owns the package address.
   */
  update(workspaceId: WorkspaceId, state: WorkspaceDocumentState | null): void {
    const key = state ? packageKeyForState(state) : null;
    if (key) {
      const existing = this.#workspaceIdByPackageKey.get(key);
      if (existing && existing !== workspaceId) {
        throw new Error(`Package session already registered: ${state.packageId}`);
      }
    }

    this.#remove(workspaceId);
    if (!key) return;

    this.#workspaceIdByPackageKey.set(key, workspaceId);
    this.#packageKeyByWorkspaceId.set(workspaceId, key);
  }

  /**
   * Resolves the live workspace session id for a package identity.
   *
   * @param identity - package id and canonical source path to look up.
   * @returns null when no live session owns the package address.
   */
  workspaceIdForPackage(identity: WorkspacePackageIdentity): WorkspaceId | null {
    return this.#workspaceIdByPackageKey.get(packageKey(identity)) ?? null;
  }

  /**
   * Resolves the live workspace session id for document package state.
   *
   * @param state - document state emitted by the utility process.
   * @returns null when the state is not package-backed or is not indexed.
   */
  workspaceIdForState(state: WorkspaceDocumentState): WorkspaceId | null {
    const key = packageKeyForState(state);
    return key ? (this.#workspaceIdByPackageKey.get(key) ?? null) : null;
  }

  #remove(workspaceId: WorkspaceId): void {
    const previousKey = this.#packageKeyByWorkspaceId.get(workspaceId);
    if (!previousKey) return;

    if (this.#workspaceIdByPackageKey.get(previousKey) === workspaceId) {
      this.#workspaceIdByPackageKey.delete(previousKey);
    }
    this.#packageKeyByWorkspaceId.delete(workspaceId);
  }
}

function packageKeyForState(state: WorkspaceDocumentState): string | null {
  if (!state.packageId || !state.canonicalPath) return null;

  return packageKey({
    packageId: state.packageId,
    canonicalPath: state.canonicalPath,
  });
}

function packageKey(
  identity: Pick<WorkspacePackageIdentity, "packageId" | "canonicalPath">,
): string {
  return `${identity.packageId}\0${identity.canonicalPath}`;
}
