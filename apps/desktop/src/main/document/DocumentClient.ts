import type { MessagePortMain } from "electron";
import type { WorkspaceDocumentState } from "../../shared/workspace/protocol";
import type { DocumentCallMap, DocumentEventMap } from "../../shared/ipc/contract";
import { Channel, electronPortTransport } from "../../shared/workspace/channel";

export interface Document {
  readonly connected: boolean;
  state(): Promise<WorkspaceDocumentState | null>;
  create(): Promise<void>;
  save(path: string | null): Promise<WorkspaceDocumentState>;
  open(path: string): Promise<void>;
}

/**
 * Main-process client for document operations served by the renderer.
 *
 * @remarks
 * The renderer owns the committed edit lane, so main routes document state,
 * create, save, and open requests through this client instead of reading or
 * mutating the utility process directly.
 */
export class DocumentClient implements Document {
  #channel: Channel<DocumentCallMap, DocumentEventMap> | null = null;

  get connected(): boolean {
    return this.#channel !== null;
  }

  /** Replaces the active renderer document lane. */
  connect(port: MessagePortMain): void {
    this.#channel?.dispose();
    this.#channel = new Channel<DocumentCallMap, DocumentEventMap>(electronPortTransport(port));
  }

  state(): Promise<WorkspaceDocumentState | null> {
    return this.#call("document.state", undefined);
  }

  create(): Promise<void> {
    return this.#call("document.create", undefined);
  }

  save(path: string | null): Promise<WorkspaceDocumentState> {
    return this.#call("document.save", { path });
  }

  open(path: string): Promise<void> {
    return this.#call("document.open", { path });
  }

  /** Disconnects the active renderer document lane. */
  dispose(): void {
    this.#channel?.dispose();
    this.#channel = null;
  }

  #call<K extends keyof DocumentCallMap & string>(
    type: K,
    payload: DocumentCallMap[K]["request"],
  ): Promise<DocumentCallMap[K]["response"]> {
    if (!this.#channel) {
      return Promise.reject(new Error("document renderer is not connected"));
    }

    return this.#channel.call(type, payload);
  }
}
