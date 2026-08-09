import type { ShiftBridge } from "@shift/bridge";
import fs from "node:fs";
import type { WorkspaceDocumentIdentity } from "../../shared/workspace/protocol";
import type { DocumentStorage } from "./DocumentStorage";
import {
  DocumentAddress,
  type DocumentBinding,
  type DocumentOpenAction,
  type DocumentOpenResult,
  type WorkspaceAllocation,
} from "./types";

/** Opens canonical SQLite documents against stable app-owned recovery allocations. */
export class DocumentOpener {
  readonly #bridge: ShiftBridge;
  readonly #documents: DocumentStorage;

  constructor(bridge: ShiftBridge, documents: DocumentStorage) {
    this.#bridge = bridge;
    this.#documents = documents;
  }

  open(identity: WorkspaceDocumentIdentity): DocumentOpenResult {
    const action = this.#actionFor(identity);

    switch (action.kind) {
      case "create":
        return this.#create(identity);
      case "resume":
        return this.#resume(identity, action.binding);
      case "move":
        return this.#move(identity, action.binding);
      case "replace":
        return this.#replace(identity, action.binding);
      default:
        assertNever(action);
    }
  }

  #actionFor(identity: WorkspaceDocumentIdentity): DocumentOpenAction {
    const address = DocumentAddress.fromIdentity(identity);
    const exactBinding = this.#documents.documentBinding(address);
    if (exactBinding) {
      return fs.existsSync(exactBinding.recoveryPath)
        ? { kind: "resume", binding: exactBinding }
        : { kind: "replace", binding: exactBinding };
    }

    const movedBinding = this.#movedBinding(identity);
    return movedBinding ? { kind: "move", binding: movedBinding } : { kind: "create" };
  }

  #create(identity: WorkspaceDocumentIdentity): DocumentOpenResult {
    const workspace = this.#documents.createWorkspace();

    try {
      return this.#openDocument(identity, workspace);
    } catch (error) {
      this.#documents.deleteWorkspace(workspace.workspaceId);
      throw error;
    }
  }

  #resume(identity: WorkspaceDocumentIdentity, binding: DocumentBinding): DocumentOpenResult {
    const opened = this.#openDocument(identity, binding);

    try {
      this.#removeOtherBindings(opened.address, binding.workspaceId);
      return opened;
    } catch (error) {
      this.#bridge.closeWorkspace();
      throw error;
    }
  }

  #move(identity: WorkspaceDocumentIdentity, binding: DocumentBinding): DocumentOpenResult {
    return this.#resume(identity, binding);
  }

  #replace(identity: WorkspaceDocumentIdentity, binding: DocumentBinding): DocumentOpenResult {
    const opened = this.#create(identity);
    this.#documents.deleteWorkspace(binding.workspaceId);
    return opened;
  }

  #openDocument(
    identity: WorkspaceDocumentIdentity,
    workspace: WorkspaceAllocation,
  ): DocumentOpenResult {
    const address = DocumentAddress.fromIdentity(identity);
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
      return { workspace, address };
    } catch (error) {
      if (opened) this.#bridge.closeWorkspace();
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

function assertNever(value: never): never {
  throw new Error(`unknown document open action: ${JSON.stringify(value)}`);
}
