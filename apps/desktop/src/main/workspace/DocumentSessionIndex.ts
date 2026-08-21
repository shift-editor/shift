import type {
  WorkspaceDocumentState,
  WorkspaceDocumentIdentity,
} from "../../shared/workspace/protocol";
import type { WorkspaceProcess } from "./WorkspaceProcess";
import type { FontSessionId } from "./FontSessionHost";

export type IndexedDocumentSession = {
  readonly workspaceId: FontSessionId;
  readonly workspaceProcess: Pick<WorkspaceProcess, "onDocumentChanged">;
};

/**
 * Indexes live workspace sessions by canonical document identity.
 *
 * @remarks
 * This is main-process live-session bookkeeping. It enforces that at most one
 * live {@link FontSessionId} owns a `DocumentId`, and it follows document state
 * changes because Save As gives the session a new identity.
 */
export class DocumentSessionIndex {
  readonly #workspaceIdByDocumentId = new Map<string, FontSessionId>();
  readonly #documentIdByWorkspaceId = new Map<FontSessionId, string>();
  readonly #unlistenByWorkspaceId = new Map<FontSessionId, () => void>();

  /**
   * Tracks document state changes for one live workspace session.
   *
   * @param session - live workspace session with a document-change source.
   * @throws {Error} when the session is already tracked.
   */
  track(session: IndexedDocumentSession): void {
    if (this.#unlistenByWorkspaceId.has(session.workspaceId)) {
      throw new Error(`Document session already tracked: ${session.workspaceId}`);
    }

    this.#unlistenByWorkspaceId.set(
      session.workspaceId,
      session.workspaceProcess.onDocumentChanged((state) => {
        this.update(session.workspaceId, state);
      }),
    );
  }

  /**
   * Stops tracking a live workspace session and removes its document ownership.
   *
   * @param workspaceId - session identity being unregistered.
   */
  untrack(workspaceId: FontSessionId): void {
    this.#remove(workspaceId);

    const unlisten = this.#unlistenByWorkspaceId.get(workspaceId);
    if (unlisten) unlisten();
    this.#unlistenByWorkspaceId.delete(workspaceId);
  }

  /**
   * Updates the document identity owned by a workspace session.
   *
   * @param workspaceId - live workspace session receiving document state.
   * @param state - latest document state; null clears document ownership.
   * @throws {Error} when another live session already owns the `DocumentId`.
   */
  update(workspaceId: FontSessionId, state: WorkspaceDocumentState | null): void {
    const documentId = state?.documentId ?? null;
    if (documentId) {
      const existing = this.#workspaceIdByDocumentId.get(documentId);
      if (existing && existing !== workspaceId) {
        throw new Error(`Document session already registered: ${state.documentId}`);
      }
    }

    this.#remove(workspaceId);
    if (!documentId) return;

    this.#workspaceIdByDocumentId.set(documentId, workspaceId);
    this.#documentIdByWorkspaceId.set(workspaceId, documentId);
  }

  /**
   * Resolves the live workspace session id for a document identity.
   *
   * @param identity - document identity to look up; its path does not create a second session.
   * @returns null when no live session owns the `DocumentId`.
   */
  workspaceIdForDocument(identity: WorkspaceDocumentIdentity): FontSessionId | null {
    return this.#workspaceIdByDocumentId.get(identity.documentId) ?? null;
  }

  /**
   * Resolves the live workspace session id for document state.
   *
   * @param state - document state emitted by the utility process.
   * @returns null when the state is not document-backed or is not indexed.
   */
  workspaceIdForState(state: WorkspaceDocumentState): FontSessionId | null {
    return state.documentId ? (this.#workspaceIdByDocumentId.get(state.documentId) ?? null) : null;
  }

  #remove(workspaceId: FontSessionId): void {
    const previousDocumentId = this.#documentIdByWorkspaceId.get(workspaceId);
    if (!previousDocumentId) return;

    if (this.#workspaceIdByDocumentId.get(previousDocumentId) === workspaceId) {
      this.#workspaceIdByDocumentId.delete(previousDocumentId);
    }
    this.#documentIdByWorkspaceId.delete(workspaceId);
  }
}
