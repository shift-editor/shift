import { createBridge, type ShiftBridge } from "@shift/bridge";
import path from "node:path";
import { serveChannel, type ChannelServer, type Transport } from "../../shared/workspace/channel";
import type {
  ShellCallMap,
  ShellEventMap,
  SlugAtlasStreamControl,
  SlugAtlasStreamMessage,
  SyncCallMap,
  SyncEventMap,
  WorkspaceDocumentSourceKind,
  WorkspaceDocumentState,
  WorkspaceExportResult,
  WorkspaceGlyphSnapshot,
  WorkspacePackageIdentity,
  WorkspaceSnapshot,
} from "../../shared/workspace/protocol";
import { errorToMessage } from "../../shared/errors";
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
type SlugAtlasPort = {
  postMessage(message: SlugAtlasStreamMessage): void;
  once(event: string, listener: (value?: unknown) => void): void;
  off(event: string, listener: (value?: unknown) => void): void;
  start(): void;
  close(): void;
};

function nextSlugAtlasControl(port: SlugAtlasPort): Promise<SlugAtlasStreamControl> {
  return new Promise((resolve, reject) => {
    const onMessage = (value?: unknown) => {
      cleanup();
      const message =
        typeof value === "object" && value !== null && "data" in value
          ? (value as { data: unknown }).data
          : value;
      if (typeof message !== "object" || message === null || !("kind" in message)) {
        reject(new Error("resident Slug stream received invalid backpressure"));
        return;
      }
      resolve(message as SlugAtlasStreamControl);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("resident Slug stream response port closed"));
    };
    const cleanup = () => {
      port.off("message", onMessage);
      port.off("close", onClose);
    };
    port.once("message", onMessage);
    port.once("close", onClose);
  });
}

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
      "workspace.export": ({ path }) => this.#export(path),
      "workspace.glyphSnapshots": ({ requests }) =>
        this.#serialize(() => this.#bridge.getGlyphSnapshots(requests) as WorkspaceGlyphSnapshot[]),
      "workspace.glyphProjections": ({ glyphIds }) =>
        this.#serialize(() => this.#bridge.getGlyphProjections(glyphIds)),
      "workspace.glyphPreviews": ({ glyphIds, location }) =>
        this.#serialize(() => this.#bridge.getGlyphPreviews(glyphIds, location)),
      "workspace.slugAtlasPrepare": ({ alignment }) =>
        this.#serialize(() => this.#bridge.prepareSlugAtlas(alignment)),
      "workspace.slugAtlasStream": ({ generation, maximumLength }, context) =>
        this.#serialize(() => this.#streamSlugAtlas(generation, maximumLength, context.ports)),
      "workspace.slugAtlasDiscard": ({ generation }) =>
        this.#serialize(() => {
          this.#bridge.discardSlugAtlas(generation);
          return null;
        }),
      "workspace.mapLocation": (location) =>
        this.#serialize(() => this.#bridge.mapLocation(location)),
    });
  }

  async #streamSlugAtlas(
    generation: number,
    maximumLength: number,
    ports: readonly unknown[],
  ): Promise<null> {
    const port = ports.at(0) as SlugAtlasPort | undefined;
    if (!port) throw new Error("workspace.slugAtlasStream requires a transferred response port");

    let totalLength = 0;
    port.start();
    try {
      const reader = this.#bridge.streamSlugAtlas(generation, maximumLength).getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          const bytes = new Uint8Array(
            value.buffer as ArrayBuffer,
            value.byteOffset,
            value.byteLength,
          );
          const nextOffset = totalLength + bytes.byteLength;
          const acknowledgment = nextSlugAtlasControl(port);
          port.postMessage({ kind: "chunk", offset: totalLength, bytes });
          const control = await acknowledgment;
          if (control.kind === "cancel") throw new Error(control.message);
          if (control.kind !== "ack" || control.nextOffset !== nextOffset) {
            throw new Error(`resident Slug stream expected acknowledgment ${nextOffset}`);
          }
          totalLength = nextOffset;
        }
      } catch (error) {
        try {
          await reader.cancel(errorToMessage(error));
        } catch (cancelError) {
          console.error("failed to cancel native Slug stream", cancelError);
        }
        throw error;
      } finally {
        reader.releaseLock();
      }
      port.postMessage({ kind: "complete", totalLength });
      return null;
    } catch (error) {
      try {
        port.postMessage({ kind: "error", message: errorToMessage(error) });
      } catch (postError) {
        console.error("failed to report resident Slug stream error", postError);
      }
      throw error;
    } finally {
      port.close();
    }
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
      metricDefinitions: this.#bridge.getMetricDefinitions(),
      sourceMetricsInterpolation: this.#bridge.getSourceMetricsInterpolation(),
      glyphs: this.#bridge.getGlyphs(),
      sources: this.#bridge.getSources(),
      axes: this.#bridge.getAxes(),
      axisMappings: this.#bridge.getAxisMappings(),
      namedInstances: this.#bridge.getNamedInstances(),
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

  async #export(outputPath: string): Promise<WorkspaceExportResult> {
    const { completion } = await this.#serialize(() => ({
      // exportWorkspace captures its immutable native snapshot synchronously.
      // Wrapping the completion releases the workspace queue while fontc runs.
      completion: this.#bridge.exportWorkspace({
        path: outputPath,
        format: "ttf",
      }),
    }));
    const result = await completion;
    return { path: result.path, format: "ttf" };
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
