import { createBridge, type ShiftBridge } from "@shift/bridge";
import path from "node:path";
import { serveChannel, type ChannelServer, type Transport } from "../../shared/workspace/channel";
import type {
  ShellCallMap,
  ShellEventMap,
  SyncCallMap,
  SyncEventMap,
  WorkspaceDocumentSourceKind,
  WorkspaceDocumentState,
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
  readonly #shellTransport: Transport;
  readonly #syncTransport: (port: unknown) => Transport;
  #shell: ChannelServer<ShellEventMap> | null = null;
  #sync: ChannelServer<SyncEventMap> | null = null;
  #documentId: string | null = null;
  #operations: Promise<void> = Promise.resolve();

  constructor(options: WorkspaceHostOptions) {
    this.#bridge = createBridge();
    this.#documents = new DocumentStorage(options.documentsRoot);
    this.#shellTransport = options.shell;
    this.#syncTransport = options.syncTransport;
  }

  /** Serves the shell lane and announces readiness. Drafts are retained. */
  start(): void {
    this.#shell = serveChannel<ShellCallMap, ShellEventMap>(this.#shellTransport, {
      "workspace.connect": (_payload, context) => {
        this.#connectSyncLane(context.ports);
      },
      "document.state": () => this.#serialize(() => this.#documentState()),
    });

    this.#shell.emit("ready", undefined);
  }

  #connectSyncLane(ports: readonly unknown[]): void {
    const port = ports.at(0);
    if (!port) {
      throw new Error("workspace.connect requires a transferred sync-lane port");
    }

    this.#sync?.dispose();
    this.#sync = serveChannel<SyncCallMap, SyncEventMap>(this.#syncTransport(port), {
      "workspace.create": () => this.#serialize(() => this.#create()),
      "workspace.snapshot": () =>
        this.#serialize(() =>
          this.#documentId === null ? null : this.#snapshot(this.#documentId),
        ),
      "document.state": () => this.#serialize(() => this.#documentState()),
      "workspace.apply": ({ intents, label }) =>
        this.#serialize(() => {
          const applied = this.#bridge.apply(intents, label);
          return { applied, documentState: this.#emitDocumentChanged() };
        }),
      "workspace.undo": () =>
        this.#serialize(() => {
          const applied = this.#bridge.undo();
          const documentState = applied ? this.#emitDocumentChanged() : this.#documentState();
          return { applied, documentState };
        }),
      "workspace.redo": () =>
        this.#serialize(() => {
          const applied = this.#bridge.redo();
          const documentState = applied ? this.#emitDocumentChanged() : this.#documentState();
          return { applied, documentState };
        }),
      // Save rides the edit lane: the same #serialize queue orders it behind
      // every committed apply/undo/redo, so it never writes stale state.
      "workspace.open": ({ path }) => this.#serialize(() => this.#open(path)),
      "workspace.save": () => this.#serialize(() => this.#save()),
      "workspace.saveAs": ({ path }) => this.#serialize(() => this.#saveAs(path)),
      "workspace.layer": ({ layerId }) => this.#serialize(() => this.#bridge.getLayer(layerId)),
    });
  }

  #create(): WorkspaceSnapshot {
    const draft = this.#documents.createDraft();

    this.#bridge.createUntitledWorkspace(draft.storePath);
    this.#bridge.setDocumentId(draft.documentId);
    this.#documentId = draft.documentId;

    const snapshot = this.#snapshot(draft.documentId);
    this.#emitDocumentChanged();
    return snapshot;
  }

  #snapshot(documentId: string): WorkspaceSnapshot {
    return {
      documentId,
      metadata: this.#bridge.getMetadata(),
      metrics: this.#bridge.getMetrics(),
      glyphs: this.#bridge.getGlyphs(),
      sources: this.#bridge.getSources(),
      axes: this.#bridge.getAxes(),
    };
  }

  #open(sourcePath: string): WorkspaceSnapshot {
    const recovery = isShiftPackagePath(sourcePath)
      ? this.#bridge.findRecoverableWorkspace(sourcePath, this.#documents.listDrafts())
      : null;
    const document = recovery ?? this.#documents.createDraft();

    if (recovery) {
      this.#bridge.resumeWorkspaceForSource(recovery.storePath, sourcePath);
    } else {
      this.#bridge.openWorkspace(sourcePath, document.storePath);
    }

    this.#bridge.setDocumentId(document.documentId);
    this.#documentId = document.documentId;
    const snapshot = this.#snapshot(document.documentId);
    this.#emitDocumentChanged();

    return snapshot;
  }

  #save(): WorkspaceDocumentState {
    this.#bridge.saveWorkspace();
    return this.#emitDocumentChanged();
  }

  #saveAs(path: string): WorkspaceDocumentState {
    this.#bridge.saveWorkspaceAs(path);
    return this.#emitDocumentChanged();
  }

  #documentState(): WorkspaceDocumentState | null {
    if (this.#documentId === null) return null;
    const state = this.#bridge.documentState();

    return {
      documentId: this.#documentId,
      sourceKind: parseDocumentSourceKind(state.sourceKind),
      saveTarget: state.saveTarget ?? null,
      dirty: state.dirty,
      needsSaveAs: state.needsSaveAs,
    };
  }

  #emitDocumentChanged(): WorkspaceDocumentState {
    const state = this.#documentState();
    if (!state) {
      throw new Error("no workspace is open");
    }

    this.#shell?.emit("document.changed", state);
    this.#sync?.emit("document.changed", state);
    return state;
  }

  #serialize<T>(operation: () => T | Promise<T>): Promise<T> {
    const run = this.#operations.then(operation);
    this.#operations = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function parseDocumentSourceKind(sourceKind: string): WorkspaceDocumentSourceKind {
  if (sourceKind === "untitled" || sourceKind === "package" || sourceKind === "imported") {
    return sourceKind;
  }

  throw new Error(`unknown document source kind: ${sourceKind}`);
}

function isShiftPackagePath(sourcePath: string): boolean {
  return path.extname(sourcePath).toLowerCase() === ".shift";
}
