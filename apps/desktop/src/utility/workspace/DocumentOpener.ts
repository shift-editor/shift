import type { ShiftBridge } from "@shift/bridge";
import fs from "node:fs";
import type { WorkspaceDocumentIdentity } from "../../shared/workspace/protocol";
import type { DocumentStorage } from "./DocumentStorage";
import { DocumentAddress, type DocumentBinding, type DocumentOpenResult } from "./types";

/** Opens canonical SQLite documents against stable app-owned recovery allocations. */
export class DocumentOpener {
  readonly #bridge: ShiftBridge;
  readonly #documents: DocumentStorage;

  constructor(bridge: ShiftBridge, documents: DocumentStorage) {
    this.#bridge = bridge;
    this.#documents = documents;
  }

  open(identity: WorkspaceDocumentIdentity): DocumentOpenResult {
    const address = DocumentAddress.fromIdentity(identity);
    const exactBinding = this.#documents.documentBinding(address);
    const movedBinding = exactBinding ? null : this.#movedBinding(identity);
    const binding = exactBinding ?? movedBinding;
    const workspace =
      binding && fs.existsSync(binding.recoveryPath) ? binding : this.#documents.createWorkspace();
    const ownsFreshWorkspace = workspace !== binding;
    let opened = false;

    try {
      this.#bridge.openDocument(identity.canonicalPath, workspace.recoveryPath);
      opened = true;
      const openedState = this.#bridge.documentState();
      if (openedState.documentId !== identity.documentId) {
        throw new Error(
          `document changed during open: expected ${identity.documentId}, found ${openedState.documentId}`,
        );
      }

      this.#bridge.setWorkspaceId(workspace.workspaceId);
      this.#documents.writeDocumentBinding(address, workspace);
      if (!ownsFreshWorkspace) {
        this.#removeOtherBindings(address, workspace.workspaceId);
      }
      if (ownsFreshWorkspace && binding) {
        if (!DocumentAddress.equals(binding, address)) {
          this.#documents.removeDocumentBinding(binding);
        }
        this.#documents.deleteWorkspace(binding.workspaceId);
      }
      return { workspace, address };
    } catch (error) {
      if (opened) this.#bridge.closeWorkspace();
      if (ownsFreshWorkspace) this.#documents.deleteWorkspace(workspace.workspaceId);
      throw error;
    }
  }

  #movedBinding(identity: WorkspaceDocumentIdentity): DocumentBinding | null {
    const candidatesByWorkspaceId = new Map<string, DocumentBinding>();
    for (const binding of this.#documents.listDocumentBindings(identity.documentId)) {
      if (binding.canonicalPath === identity.canonicalPath) continue;
      if (fs.existsSync(binding.canonicalPath) || !fs.existsSync(binding.recoveryPath)) continue;

      if (!candidatesByWorkspaceId.has(binding.workspaceId)) {
        candidatesByWorkspaceId.set(binding.workspaceId, binding);
      }
    }

    return candidatesByWorkspaceId.size === 1
      ? (candidatesByWorkspaceId.values().next().value ?? null)
      : null;
  }

  #removeOtherBindings(address: DocumentAddress, workspaceId: string): void {
    for (const binding of this.#documents.listDocumentBindings(address.documentId)) {
      if (binding.workspaceId !== workspaceId || DocumentAddress.equals(binding, address)) continue;

      this.#documents.removeDocumentBinding(binding);
    }
  }
}
