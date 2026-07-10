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
  WorkspaceGlyphSnapshot,
  WorkspacePackageIdentity,
  WorkspaceSnapshot,
} from "../../shared/workspace/protocol";
import { DocumentStorage } from "./DocumentStorage";
import { PackageOpener } from "./PackageOpener";
import { PackageAddress, type DocumentAllocation } from "./types";

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
  readonly #packageOpener: PackageOpener;
  readonly #shellTransport: Transport;
  readonly #syncTransport: (port: unknown) => Transport;
  #shell: ChannelServer<ShellEventMap> | null = null;
  #sync: ChannelServer<SyncEventMap> | null = null;
  #documentId: string | null = null;
  #packageAddress: PackageAddress | null = null;
  #operations: Promise<void> = Promise.resolve();

  constructor(options: WorkspaceHostOptions) {
    this.#bridge = createBridge();
    this.#documents = new DocumentStorage(options.documentsRoot);
    this.#packageOpener = new PackageOpener(this.#bridge, this.#documents);
    this.#shellTransport = options.shell;
    this.#syncTransport = options.syncTransport;
  }

  /** Serves the shell lane and announces readiness. Drafts are retained. */
  start(): void {
    this.#shell = serveChannel<ShellCallMap, ShellEventMap>(this.#shellTransport, {
      "workspace.create": () => this.#serialize(() => this.#create()),
      "workspace.inspectPackage": ({ path }) => this.#serialize(() => this.#inspectPackage(path)),
      "workspace.open": ({ path }) => this.#serialize(() => this.#open(path)),
      "workspace.close": ({ discard }) => this.#serialize(() => this.#close(discard)),
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
      "workspace.save": () => this.#serialize(() => this.#save()),
      "workspace.saveAs": ({ path }) => this.#serialize(() => this.#saveAs(path)),
      "workspace.glyphSnapshots": ({ requests }) =>
        this.#serialize(() => this.#bridge.getGlyphSnapshots(requests) as WorkspaceGlyphSnapshot[]),
    });
  }

  #create(): WorkspaceDocumentState {
    const document = this.#documents.createDocument();

    this.#bridge.createUntitledWorkspace(document.storePath);
    this.#bridge.setDocumentId(document.documentId);
    this.#documentId = document.documentId;
    this.#packageAddress = null;

    return this.#emitDocumentChanged();
  }

  #inspectPackage(path: string): WorkspacePackageIdentity {
    const identity = this.#bridge.inspectPackage(path);
    return {
      packageId: identity.packageId,
      canonicalPath: identity.canonicalPath,
      fingerprint: identity.fingerprint,
    };
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

  #open(sourcePath: string): WorkspaceDocumentState {
    if (isShiftPackagePath(sourcePath)) {
      return this.#openPackage(sourcePath);
    }

    const document = this.#documents.createDocument();
    this.#bridge.openWorkspace(sourcePath, document.storePath);
    this.#bridge.setDocumentId(document.documentId);
    this.#documentId = document.documentId;
    this.#packageAddress = null;

    return this.#emitDocumentChanged();
  }

  #openPackage(sourcePath: string): WorkspaceDocumentState {
    const identity = this.#inspectPackage(sourcePath);
    const opened = this.#packageOpener.open(identity);

    this.#adoptDocument(opened.document, opened.address);
    return this.#emitDocumentChanged();
  }

  #adoptDocument(document: DocumentAllocation, address: PackageAddress | null): void {
    this.#documentId = document.documentId;
    this.#packageAddress = address;
  }

  #save(): WorkspaceDocumentState {
    this.#bridge.saveWorkspace();
    return this.#emitDocumentChanged();
  }

  #saveAs(savePath: string): WorkspaceDocumentState {
    const oldAddress = this.#packageAddress;

    this.#bridge.saveWorkspaceAs(savePath);
    const identity = this.#inspectPackage(savePath);
    const newAddress = PackageAddress.fromIdentity(identity);
    const documentId = this.#requireDocumentId();

    this.#documents.writePackageBinding(newAddress, documentId);
    if (oldAddress && !PackageAddress.equals(oldAddress, newAddress)) {
      this.#documents.removePackageBinding(oldAddress);
    }
    this.#packageAddress = newAddress;

    return this.#emitDocumentChanged();
  }

  #close(discard: boolean): null {
    const state = this.#documentState();
    if (!state) return null;
    if (state.dirty && !discard) {
      throw new Error("cannot close a dirty workspace without discard");
    }

    const documentId = state.documentId;
    const address = this.#packageAddress;

    this.#bridge.closeWorkspace();
    this.#documentId = null;
    this.#packageAddress = null;

    if (address) this.#documents.removePackageBinding(address);
    this.#documents.deleteDocument(documentId);
    this.#shell?.emit("document.changed", null);
    this.#sync?.emit("document.changed", null);

    return null;
  }

  #documentState(): WorkspaceDocumentState | null {
    if (this.#documentId === null) return null;
    const state = this.#bridge.documentState();
    const address = this.#packageAddress;

    return {
      documentId: this.#documentId,
      sourceKind: parseDocumentSourceKind(state.sourceKind),
      saveTarget: state.saveTarget ?? null,
      packageId: address?.packageId ?? null,
      canonicalPath: address?.canonicalPath ?? null,
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

  #requireDocumentId(): string {
    if (this.#documentId === null) {
      throw new Error("no workspace is open");
    }

    return this.#documentId;
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
