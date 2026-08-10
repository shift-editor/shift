import { createBridge, type ShiftBridge } from "@shift/bridge";
import type { GlyphSnapshot } from "@shift/types";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serveChannel, type ChannelServer, type Transport } from "../../shared/workspace/channel";
import type {
  FontSourceAtlasPageRequest,
  FontSourceSession,
  FontSourceSnapshot,
  ShellCallMap,
  ShellEventMap,
  SlugAtlasOrigin,
  SyncCallMap,
  SyncEventMap,
  WorkspaceDocumentSourceKind,
  WorkspaceDocumentState,
  WorkspaceExportResult,
  WorkspacePackageIdentity,
  WorkspacePreviewFont,
  WorkspaceSlugAtlas,
  WorkspaceSlugAtlasPageRequest,
  WorkspaceSnapshot,
} from "../../shared/workspace/protocol";
import { PortByteStream } from "../../shared/workspace/PortByteStream";
import {
  closeCachedAtlas,
  DEFAULT_ATLAS_CACHE_BYTE_BUDGET,
  loadCachedAtlasPage,
  openCachedAtlas,
  pruneCachedAtlases,
  publishCachedAtlas,
  stageCachedAtlasPage,
} from "./CachedAtlas";
import { DocumentStorage } from "./DocumentStorage";
import { PackageOpener } from "./PackageOpener";
import {
  PackageAddress,
  type CachedAtlasBuild,
  type CachedAtlasPageRequest,
  type CachedAtlasPageSink,
  type DocumentAllocation,
  type OpenedCachedAtlas,
  type OpenedCachedAtlasPage,
  type PreparedAtlasPage,
  type StagedCachedAtlasPage,
} from "./types";

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
  atlasCacheRoot: string;
  atlasCacheByteBudget?: number;
  shell: Transport;
  /** Adapts any transferred workspace port into a transport. */
  portTransport: (port: unknown) => Transport;
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
  readonly #atlasCacheRoot: string;
  readonly #atlasCacheByteBudget: number;
  readonly #shellTransport: Transport;
  readonly #portTransport: (port: unknown) => Transport;
  #shell: ChannelServer<ShellEventMap> | null = null;
  #sync: ChannelServer<SyncEventMap> | null = null;
  #documentId: string | null = null;
  #fontSource: FontSourceSnapshot | null = null;
  #packageAddress: PackageAddress | null = null;
  #atlasCacheRevision: string | null = null;
  #cachedGeneration = 0;
  #cachedPages = new Map<number, OpenedCachedAtlasPage>();
  #openedCachedAtlasKey: string | null = null;
  #openedCachedAtlas: OpenedCachedAtlas | null = null;
  #preparedPages = new Map<number, PreparedAtlasPage>();
  #preparedSourcePages = new Map<number, number>();
  #atlasBuilds = new Map<string, CachedAtlasBuild>();
  #operations: Promise<void> = Promise.resolve();

  constructor(options: WorkspaceHostOptions) {
    this.#bridge = createBridge();
    this.#documents = new DocumentStorage(options.documentsRoot);
    this.#packageOpener = new PackageOpener(this.#bridge, this.#documents);
    this.#atlasCacheRoot = options.atlasCacheRoot;
    this.#atlasCacheByteBudget = options.atlasCacheByteBudget ?? DEFAULT_ATLAS_CACHE_BYTE_BUDGET;
    this.#shellTransport = options.shell;
    this.#portTransport = options.portTransport;
  }

  /** Serves the shell lane and announces readiness. Drafts are retained. */
  start(): void {
    this.#shell = serveChannel<ShellCallMap, ShellEventMap>(this.#shellTransport, {
      "workspace.create": () => this.#serialize(() => this.#create()),
      "workspace.inspectPackage": ({ path }) => this.#serialize(() => this.#inspectPackage(path)),
      "workspace.open": ({ path }) => this.#serialize(() => this.#open(path)),
      "workspace.close": ({ discard }) => this.#serialize(() => this.#close(discard)),
      "source.open": ({ path }) => this.#serialize(() => this.#openFontSource(path)),
      "source.close": () => this.#serialize(() => this.#closeFontSource()),
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
    this.#sync = serveChannel<SyncCallMap, SyncEventMap>(this.#portTransport(port), {
      "workspace.snapshot": () =>
        this.#serialize(() =>
          this.#documentId === null ? null : this.#snapshot(this.#documentId),
        ),
      "source.snapshot": () => this.#serialize(() => this.#fontSource),
      "source.glyph": ({ glyphId }) =>
        this.#serialize(() => this.#bridge.readFontSourceGlyph(glyphId)),
      "source.atlasPagePrepare": (request) =>
        this.#serialize(() => this.#prepareSourceAtlasPage(request)),
      "source.atlasPageStream": ({ generation, maximumLength }, context) =>
        this.#serialize(() =>
          this.#streamSourceAtlasPage(generation, maximumLength, context.ports),
        ),
      "source.atlasPageDiscard": ({ pageIndex, generation }) =>
        this.#serialize(() => this.#discardSourceAtlasPage(pageIndex, generation)),
      "source.atlasWeights": ({ coordinates }) =>
        this.#serialize(() => this.#bridge.sourceAtlasWeights(coordinates)),
      "document.state": () => this.#serialize(() => this.#documentState()),
      "workspace.apply": ({ intents, label }) =>
        this.#serialize(() => {
          const applied = this.#bridge.apply(intents, label);
          this.#atlasCacheRevision = null;
          return { applied, documentState: this.#emitDocumentChanged() };
        }),
      "workspace.undo": () =>
        this.#serialize(() => {
          const applied = this.#bridge.undo();
          if (applied) this.#atlasCacheRevision = null;
          const documentState = applied ? this.#emitDocumentChanged() : this.#documentState();
          return { applied, documentState };
        }),
      "workspace.redo": () =>
        this.#serialize(() => {
          const applied = this.#bridge.redo();
          if (applied) this.#atlasCacheRevision = null;
          const documentState = applied ? this.#emitDocumentChanged() : this.#documentState();
          return { applied, documentState };
        }),
      // Save rides the edit lane: the same #serialize queue orders it behind
      // every committed apply/undo/redo, so it never writes stale state.
      "workspace.save": () => this.#serialize(() => this.#save()),
      "workspace.saveAs": ({ path }) => this.#serialize(() => this.#saveAs(path)),
      "workspace.export": ({ path }) => this.#export(path),
      "workspace.compilePreview": () => this.#compilePreview(),
      "workspace.glyphSnapshots": ({ requests }) =>
        this.#serialize(() => this.#bridge.getGlyphSnapshots(requests) as GlyphSnapshot[]),
      "workspace.glyphProjections": ({ glyphIds }) =>
        this.#serialize(() => this.#bridge.getGlyphProjections(glyphIds)),
      "workspace.glyphPreviews": ({ glyphIds, location }) =>
        this.#serialize(() => this.#bridge.getGlyphPreviews(glyphIds, location)),
      "workspace.slugAtlasPrepare": ({ alignment }) =>
        this.#serialize(() => this.#bridge.prepareSlugAtlas(alignment)),
      "workspace.slugAtlasPagePrepare": (request) =>
        this.#serialize(() => this.#prepareSlugAtlasPage(request)),
      "workspace.slugAtlasStream": ({ generation, maximumLength }, context) =>
        this.#serialize(() => this.#streamSlugAtlas(generation, maximumLength, context.ports)),
      "workspace.slugAtlasPageStream": ({ generation, origin, maximumLength }, context) =>
        this.#serialize(() =>
          this.#streamSlugAtlasPage(generation, origin, maximumLength, context.ports),
        ),
      "workspace.slugAtlasDiscard": ({ generation }) =>
        this.#serialize(() => {
          this.#bridge.discardSlugAtlas(generation);
          return null;
        }),
      "workspace.slugAtlasPageDiscard": ({ generation, origin }) =>
        this.#serialize(() => this.#discardSlugAtlasPage(generation, origin)),
      "workspace.mapLocation": (location) =>
        this.#serialize(() => this.#bridge.mapLocation(location)),
    });
  }

  async #prepareSlugAtlasPage(request: WorkspaceSlugAtlasPageRequest): Promise<WorkspaceSlugAtlas> {
    const started = performance.now();
    const cacheRequest: CachedAtlasPageRequest = {
      ...request,
      key: {
        documentKey: this.#requireDocumentId(),
        revisionKey: this.#currentAtlasCacheRevision(),
      },
    };
    const cached = await this.#loadCachedAtlasPage(cacheRequest);
    if (cached) {
      this.#cachedGeneration += 1;
      if (!Number.isSafeInteger(this.#cachedGeneration)) {
        throw new Error("cached Slug atlas generation overflow");
      }

      const generation = this.#cachedGeneration;
      this.#cachedPages.set(generation, cached);
      logSlugAtlasProfile({
        boundary: "utility",
        phase: "prepare-page",
        pageIndex: request.pageIndex,
        origin: "cached",
        durationMs: performance.now() - started,
      });
      return { ...cached.atlas, generation, origin: "cached" };
    }

    const descriptor = this.#bridge.prepareSlugAtlasPage(request.glyphIds, request.alignment);
    this.#preparedPages.set(descriptor.generation, {
      request: cacheRequest,
      descriptor,
    });
    logSlugAtlasProfile({
      boundary: "utility",
      phase: "prepare-page",
      pageIndex: request.pageIndex,
      origin: "native",
      durationMs: performance.now() - started,
    });
    return { ...descriptor, origin: "native" };
  }

  async #loadCachedAtlasPage(
    request: CachedAtlasPageRequest,
  ): Promise<OpenedCachedAtlasPage | null> {
    const openedKey = cachedAtlasOpenKey(request);
    if (this.#openedCachedAtlasKey !== openedKey) {
      await this.#closeOpenedCachedAtlas();
      this.#openedCachedAtlasKey = openedKey;
      this.#openedCachedAtlas = await openCachedAtlas(this.#atlasCacheRoot, request);
      if (this.#openedCachedAtlas) {
        try {
          await pruneCachedAtlases(this.#atlasCacheRoot, this.#atlasCacheByteBudget);
        } catch (error) {
          console.error("failed to prune cached Slug atlases", error);
        }
      }
    }

    const opened = this.#openedCachedAtlas;
    if (!opened) return null;

    const page = await loadCachedAtlasPage(opened, request);
    if (page) return page;

    await this.#closeOpenedCachedAtlas();
    return null;
  }

  async #closeOpenedCachedAtlas(): Promise<void> {
    const opened = this.#openedCachedAtlas;
    this.#openedCachedAtlas = null;
    if (!opened) return;

    try {
      await closeCachedAtlas(opened);
    } catch (error) {
      console.error("failed to close cached Slug atlas", error);
    }
  }

  async #streamSlugAtlas(
    generation: number,
    maximumLength: number,
    ports: readonly unknown[],
  ): Promise<null> {
    const port = ports.at(0);
    if (!port) throw new Error("workspace.slugAtlasStream requires a transferred response port");

    const stream = new PortByteStream(this.#portTransport(port));
    try {
      await stream.send(
        this.#bridge.streamSlugAtlas(generation, maximumLength),
        undefined,
        maximumLength,
      );
      return null;
    } finally {
      stream.close();
    }
  }

  async #streamSlugAtlasPage(
    generation: number,
    origin: SlugAtlasOrigin,
    maximumLength: number,
    ports: readonly unknown[],
  ): Promise<null> {
    const port = ports.at(0);
    if (!port)
      throw new Error("workspace.slugAtlasPageStream requires a transferred response port");

    const stream = new PortByteStream(this.#portTransport(port));
    if (origin === "cached") {
      const cached = this.#cachedPages.get(generation);
      if (!cached) {
        stream.close();
        throw new Error(`unknown cached Slug atlas generation ${generation}`);
      }
      this.#cachedPages.delete(generation);

      try {
        const started = performance.now();
        await stream.send(cached.stream, undefined, maximumLength);
        logSlugAtlasProfile({
          boundary: "utility",
          phase: "stream-page",
          origin: "cached",
          generation,
          streamMs: performance.now() - started,
        });
        return null;
      } finally {
        stream.close();
      }
    }

    const prepared = this.#preparedPages.get(generation);
    if (!prepared) {
      stream.close();
      throw new Error(`unknown native Slug atlas generation ${generation}`);
    }
    this.#preparedPages.delete(generation);
    let sink: CachedAtlasPageSink | null = null;
    try {
      sink = stageCachedAtlasPage(this.#atlasCacheRoot, prepared.request, prepared.descriptor);
    } catch (error) {
      console.error("failed to start cached Slug atlas page", error);
    }

    try {
      const streamStarted = performance.now();
      await stream.send(
        this.#bridge.streamSlugAtlasPage(generation, maximumLength),
        async (bytes) => {
          if (!sink) return;

          try {
            await sink.write(bytes);
          } catch (error) {
            console.error("failed to stage cached Slug atlas page", error);
            const failedSink = sink;
            sink = null;
            try {
              await failedSink.discard();
            } catch (discardError) {
              console.error("failed to discard cached Slug atlas page", discardError);
            }
          }
        },
        maximumLength,
      );
      const streamMs = performance.now() - streamStarted;
      let cacheFinalizeMs: number | null = null;
      let cachePublicationMs: number | null = null;

      if (sink) {
        try {
          const finalizeStarted = performance.now();
          const staged = await sink.complete();
          cacheFinalizeMs = performance.now() - finalizeStarted;
          sink = null;
          const publicationStarted = performance.now();
          await this.#registerCachedAtlasPage(prepared.request, staged);
          cachePublicationMs = performance.now() - publicationStarted;
        } catch (error) {
          console.error("failed to complete cached Slug atlas page", error);
        }
      }
      logSlugAtlasProfile({
        boundary: "utility",
        phase: "stream-page",
        origin: "native",
        generation,
        pageIndex: prepared.request.pageIndex,
        streamMs,
        cacheFinalizeMs,
        cachePublicationMs,
      });
      return null;
    } catch (error) {
      if (sink) {
        try {
          await sink.discard();
        } catch (discardError) {
          console.error("failed to discard interrupted cached Slug atlas page", discardError);
        }
      }
      throw error;
    } finally {
      stream.close();
    }
  }

  #prepareSourceAtlasPage(request: FontSourceAtlasPageRequest) {
    this.#requireFontSource();
    const descriptor = this.#bridge.prepareSourceAtlasPage(
      request.pageIndex,
      request.glyphIds,
      request.coordinates,
      request.alignment,
    );
    this.#preparedSourcePages.set(descriptor.generation, request.pageIndex);
    return descriptor;
  }

  async #streamSourceAtlasPage(
    generation: number,
    maximumLength: number,
    ports: readonly unknown[],
  ): Promise<null> {
    const port = ports.at(0);
    if (!port) throw new Error("source.atlasPageStream requires a transferred response port");
    if (!this.#preparedSourcePages.has(generation)) {
      throw new Error(`unknown source atlas generation ${generation}`);
    }
    this.#preparedSourcePages.delete(generation);

    const stream = new PortByteStream(this.#portTransport(port));
    try {
      await stream.send(
        this.#bridge.streamSourceAtlasPage(generation, maximumLength),
        undefined,
        maximumLength,
      );
      return null;
    } finally {
      stream.close();
    }
  }

  #discardSourceAtlasPage(pageIndex: number, generation: number): null {
    this.#preparedSourcePages.delete(generation);
    this.#bridge.discardSourceAtlasPage(pageIndex, generation);
    return null;
  }

  async #discardSlugAtlasPage(generation: number, origin: SlugAtlasOrigin): Promise<null> {
    if (origin === "cached") {
      const cached = this.#cachedPages.get(generation);
      this.#cachedPages.delete(generation);
      if (cached) await cancelCachedAtlasPage(cached);
      return null;
    }

    this.#preparedPages.delete(generation);
    this.#bridge.discardSlugAtlasPage(generation);
    return null;
  }

  async #registerCachedAtlasPage(
    request: CachedAtlasPageRequest,
    staged: StagedCachedAtlasPage,
  ): Promise<void> {
    const buildKey = cachedAtlasBuildKey(request);
    let build = this.#atlasBuilds.get(buildKey);
    if (!build) {
      const replacementPageIndices = new Set(request.replacementPageIndices);
      const stagedPages = new Map<number, StagedCachedAtlasPage>();
      for (const previousBuild of this.#atlasBuilds.values()) {
        const compatible =
          previousBuild.key.documentKey === request.key.documentKey &&
          previousBuild.alignment === request.alignment &&
          previousBuild.pageCount === request.pageCount;
        for (const page of previousBuild.stagedPages.values()) {
          if (compatible && !replacementPageIndices.has(page.pageIndex)) {
            stagedPages.set(page.pageIndex, page);
          } else {
            fs.rmSync(page.filePath, { force: true });
          }
        }
      }
      this.#atlasBuilds.clear();

      build = {
        key: request.key,
        alignment: request.alignment,
        pageCount: request.pageCount,
        replacementPageIndices: [...request.replacementPageIndices],
        stagedPages,
      };
      this.#atlasBuilds.set(buildKey, build);
    }

    const previous = build.stagedPages.get(staged.pageIndex);
    if (previous) fs.rmSync(previous.filePath, { force: true });
    build.stagedPages.set(staged.pageIndex, staged);

    const publishedBytes = await publishCachedAtlas(this.#atlasCacheRoot, build);
    if (publishedBytes === null) return;

    this.#atlasBuilds.delete(buildKey);
    await this.#closeOpenedCachedAtlas();
    this.#openedCachedAtlasKey = null;
    await pruneCachedAtlases(this.#atlasCacheRoot, this.#atlasCacheByteBudget);
  }

  #discardAtlasBuildsExcept(retainedKey: string | null): void {
    for (const [buildKey, build] of this.#atlasBuilds) {
      if (buildKey === retainedKey) continue;

      for (const page of build.stagedPages.values()) fs.rmSync(page.filePath, { force: true });
      this.#atlasBuilds.delete(buildKey);
    }
  }

  #openFontSource(sourcePath: string): FontSourceSession {
    if (this.#documentId !== null) throw new Error("a workspace is already open");
    const canonicalPath = fs.realpathSync(sourcePath);
    const font = this.#bridge.openFontSource(canonicalPath);
    const state = {
      sessionId: `source:${canonicalPath}`,
      canonicalPath,
    };
    this.#fontSource = { ...state, font };
    this.#preparedSourcePages.clear();
    return state;
  }

  #closeFontSource(): null {
    this.#bridge.closeFontSource();
    this.#fontSource = null;
    this.#preparedSourcePages.clear();
    return null;
  }

  #create(): WorkspaceDocumentState {
    const document = this.#documents.createDocument();

    this.#bridge.createUntitledWorkspace(document.storePath);
    this.#bridge.setDocumentId(document.documentId);
    this.#documentId = document.documentId;
    this.#atlasCacheRevision = null;
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
      axisMappingBases: this.#bridge.getAxisMappingBases(),
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
    this.#atlasCacheRevision = null;
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
    this.#atlasCacheRevision = null;
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

  async #compilePreview(): Promise<WorkspacePreviewFont> {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "shift-preview-"));
    const outputPath = path.join(directory, "working.ttf");

    try {
      const started = performance.now();
      await this.#export(outputPath);
      const bytes = await fs.promises.readFile(outputPath);
      return {
        bytes: Uint8Array.from(bytes),
        compileMs: performance.now() - started,
      };
    } finally {
      await fs.promises.rm(directory, { recursive: true, force: true });
    }
  }

  async #close(discard: boolean): Promise<null> {
    const state = this.#documentState();
    if (!state) return null;
    if (state.dirty && !discard) {
      throw new Error("cannot close a dirty workspace without discard");
    }

    const documentId = state.documentId;
    const address = this.#packageAddress;

    for (const page of this.#cachedPages.values()) {
      try {
        await cancelCachedAtlasPage(page);
      } catch (error) {
        console.error("failed to cancel cached Slug atlas page", error);
      }
    }
    this.#cachedPages.clear();
    await this.#closeOpenedCachedAtlas();
    this.#openedCachedAtlasKey = null;
    this.#preparedPages.clear();
    this.#discardAtlasBuildsExcept(null);
    this.#bridge.closeWorkspace();
    this.#documentId = null;
    this.#atlasCacheRevision = null;
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

  #currentAtlasCacheRevision(): string {
    this.#atlasCacheRevision ??= this.#bridge.slugAtlasCacheRevision();
    return this.#atlasCacheRevision;
  }

  #requireDocumentId(): string {
    if (this.#documentId === null) {
      throw new Error("no workspace is open");
    }

    return this.#documentId;
  }

  #requireFontSource(): FontSourceSnapshot {
    if (!this.#fontSource) throw new Error("no retained font source is open");
    return this.#fontSource;
  }
}

function cachedAtlasOpenKey(request: CachedAtlasPageRequest): string {
  return JSON.stringify([
    request.key.documentKey,
    request.key.revisionKey,
    request.alignment,
    request.pageCount,
  ]);
}

function cachedAtlasBuildKey(request: CachedAtlasPageRequest): string {
  return JSON.stringify([
    request.key.documentKey,
    request.key.revisionKey,
    request.alignment,
    request.pageCount,
    request.replacementPageIndices,
  ]);
}

async function cancelCachedAtlasPage(page: OpenedCachedAtlasPage): Promise<void> {
  const reader = page.stream.getReader();
  try {
    await reader.cancel("cached Slug atlas page discarded");
  } finally {
    reader.releaseLock();
  }
}

function logSlugAtlasProfile(fields: Record<string, string | number | boolean | null>): void {
  if (
    process.env.SHIFT_PROFILE_SLUG_ATLAS === undefined ||
    process.env.SHIFT_PROFILE_SLUG_ATLAS === "0"
  ) {
    return;
  }

  console.info("[slug-atlas-profile]", JSON.stringify(fields));
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
