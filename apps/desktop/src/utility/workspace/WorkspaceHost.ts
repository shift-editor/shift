import { createBridge, type ShiftBridge } from "@shift/bridge";
import { serveChannel, type ChannelServer, type Transport } from "../../shared/workspace/channel";
import type {
  ShellCallMap,
  ShellEventMap,
  SyncCallMap,
  SyncEventMap,
  WorkspaceSnapshot,
} from "../../shared/workspace/protocol";
import { DocumentStorage } from "./DocumentStorage";

/**
 * Construction options for {@link WorkspaceHost}.
 *
 * @remarks
 * Both transports are injected so the full host runs in vitest without
 * Electron: tests pass `nodePortTransport`, the production entry passes
 * `parentPortTransport()` and `electronPortTransport`.
 */
export type WorkspaceHostOptions = {
  documentsRoot: string;
  shell: Transport;
  /** Adapts a port transferred through `workspace.connect` into a transport. */
  syncTransport: (port: unknown) => Transport;
};

/**
 * Utility-process owner of everything durable: the Rust bridge, SQLite, and
 * document storage.
 *
 * @remarks
 * Serves the shell lane (main ↔ utility plumbing) and one sync lane
 * (renderer ↔ utility workspace operations) at a time; a new
 * `workspace.connect` replaces the previous sync lane.
 */
export class WorkspaceHost {
  readonly #bridge: ShiftBridge;
  readonly #documents: DocumentStorage;
  readonly #shell: Transport;
  readonly #syncTransport: (port: unknown) => Transport;
  #sync: ChannelServer<SyncEventMap> | null = null;
  #documentId: string | null = null;

  constructor(options: WorkspaceHostOptions) {
    this.#bridge = createBridge();
    this.#documents = new DocumentStorage(options.documentsRoot);
    this.#shell = options.shell;
    this.#syncTransport = options.syncTransport;
  }

  /** Serves the shell lane, clears stale drafts, and announces readiness. */
  start(): void {
    this.#documents.clearDrafts();

    const shell = serveChannel<ShellCallMap, ShellEventMap>(this.#shell, {
      "workspace.connect": (_payload, context) => {
        this.#connectSyncLane(context.ports);
      },
    });

    shell.emit("ready", undefined);
  }

  #connectSyncLane(ports: readonly unknown[]): void {
    const port = ports.at(0);
    if (!port) {
      throw new Error("workspace.connect requires a transferred sync-lane port");
    }

    this.#sync?.dispose();
    this.#sync = serveChannel<SyncCallMap, SyncEventMap>(this.#syncTransport(port), {
      "workspace.create": () => this.#create(),
      "workspace.snapshot": () =>
        this.#documentId === null ? null : this.#snapshot(this.#documentId),
      "workspace.apply": ({ intents, label }) => this.#bridge.apply(intents, label),
    });
  }

  #create(): WorkspaceSnapshot {
    const draft = this.#documents.createDraft();

    this.#bridge.createUntitledWorkspace(draft.storePath);
    this.#documentId = draft.documentId;

    return this.#snapshot(draft.documentId);
  }

  #snapshot(documentId: string): WorkspaceSnapshot {
    return {
      documentId,
      metadata: this.#bridge.getMetadata(),
      metrics: this.#bridge.getMetrics(),
      glyphs: this.#bridge.getGlyphs(),
      sources: this.#bridge.getSources(),
    };
  }
}
