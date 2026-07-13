import type { MessagePortMain } from "electron";
import type {
  WorkspaceDocumentState,
  WorkspaceExportResult,
} from "../../shared/workspace/protocol";
import type { DocumentCallMap, DocumentEventMap } from "../../shared/ipc/contract";
import { Channel, electronPortTransport } from "../../shared/workspace/channel";
import { createShiftLogger, type ShiftLogger } from "../logging";

export interface Document {
  readonly connected: boolean;
  state(): Promise<WorkspaceDocumentState | null>;
  save(path: string | null): Promise<WorkspaceDocumentState>;
  export(path: string): Promise<WorkspaceExportResult>;
}

/**
 * Main-process client for document operations served by the renderer.
 *
 * @remarks
 * The renderer owns the committed edit lane, so main routes document state
 * reads and saves through this client to flush pending edits first.
 */
export class DocumentClient implements Document {
  readonly #log: ShiftLogger;

  #channel: Channel<DocumentCallMap, DocumentEventMap> | null = null;

  constructor(log: ShiftLogger = createShiftLogger("document.client")) {
    this.#log = log;
  }

  get connected(): boolean {
    return this.#channel !== null && !this.#channel.closed;
  }

  /** Replaces the active renderer document lane. */
  connect(port: MessagePortMain): void {
    if (this.#channel) {
      this.#log.info("replacing document renderer connection");
    } else {
      this.#log.info("document renderer connected");
    }

    this.#channel?.dispose();
    this.#channel = new Channel<DocumentCallMap, DocumentEventMap>(electronPortTransport(port));
  }

  state(): Promise<WorkspaceDocumentState | null> {
    return this.#call("document.state", undefined);
  }

  save(path: string | null): Promise<WorkspaceDocumentState> {
    return this.#call("document.save", { path });
  }

  /**
   * Exports the committed document snapshot selected by the renderer lane.
   *
   * @param path - destination selected by the native export dialog.
   * @returns the compiled output identity after its atomic write completes.
   * @throws {Error} when the renderer is disconnected or compilation fails.
   */
  export(path: string): Promise<WorkspaceExportResult> {
    return this.#call("document.export", { path });
  }

  /** Disconnects the active renderer document lane. */
  dispose(): void {
    if (!this.#channel) {
      this.#log.debug("document renderer already disconnected");
      return;
    }

    this.#log.info("document renderer disconnected");
    this.#channel?.dispose();
    this.#channel = null;
  }

  #call<K extends keyof DocumentCallMap & string>(
    type: K,
    payload: DocumentCallMap[K]["request"],
  ): Promise<DocumentCallMap[K]["response"]> {
    if (!this.#channel) {
      this.#log.warn("document request failed: renderer is not connected", {
        type,
      });
      return Promise.reject(new Error("document renderer is not connected"));
    }

    return this.#channel.call(type, payload);
  }
}
