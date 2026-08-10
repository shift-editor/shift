import { Channel, type Transport } from "@shared/workspace/channel";
import { domPortTransport } from "@shared/workspace/localTransports";
import { PortByteStream } from "@shared/workspace/PortByteStream";
import type {
  FontSessionMode,
  FontSourceAtlasPageRequest,
  FontSourceSnapshot,
  SlugAtlasOrigin,
  SyncCallMap,
  SyncEventMap,
  WorkspaceDocumentState,
  WorkspaceExportResult,
  WorkspaceGlyphSnapshotRequest,
  WorkspaceSlugAtlas,
  WorkspaceSlugAtlasPageRequest,
  WorkspaceSnapshot,
} from "@shared/workspace/protocol";
import type { ShiftHost } from "@shared/host/ShiftHost";
import type {
  AppliedChange,
  CatalogAtlasPage,
  CatalogAtlasWeights,
  FontIntent,
  GlyphId,
  GlyphPreview,
  GlyphSnapshot,
  GlyphProjection,
  Location,
  SlugAtlas,
} from "@shift/types";
import { signal } from "@/lib/signals/signal";

/**
 * Renderer side of the workspace sync lane.
 *
 * @remarks
 * `workspaceCell` is the renderer's latest workspace summary. `FontStore`
 * owns the renderer-local font model state; this client only
 * transports workspace calls and mirrors the summary for catch-up/recovery.
 */
export type FontSessionClientOptions = {
  /**
   * Test seam: supplies the sync-lane transport directly (in-process
   * WorkspaceHost over node ports). Production uses the preload port relay.
   */
  transport?: () => Promise<Transport>;
  mode?: FontSessionMode;
};

export class FontSessionClient {
  readonly workspaceCell = signal<WorkspaceSnapshot | null>(null);
  readonly sourceCell = signal<FontSourceSnapshot | null>(null);
  readonly documentStateCell = signal<WorkspaceDocumentState | null>(null);

  readonly #mode: FontSessionMode;
  readonly #host: ShiftHost | null;
  readonly #transport: (() => Promise<Transport>) | null;
  #channel: Channel<SyncCallMap, SyncEventMap> | null = null;
  #connection: Promise<void> | null = null;

  constructor(host: ShiftHost | null, options: FontSessionClientOptions = {}) {
    this.#mode = options.mode ?? "authored";
    this.#host = host;
    this.#transport = options.transport ?? null;
  }

  get mode(): FontSessionMode {
    return this.#mode;
  }

  /**
   * Connects this renderer client to its bound workspace.
   */
  connect(): Promise<void> {
    if (!this.#connection) {
      this.#connection = this.#connect();
    }

    return this.#connection;
  }

  dispose(): void {
    this.#channel?.dispose();
    this.#channel = null;
    this.#connection = null;
    this.workspaceCell.set(null);
    this.sourceCell.set(null);
    this.documentStateCell.set(null);
  }

  /**
   * Applies an intent set; the response is pure replace-grade state.
   *
   * @param intents - Complete set of edits to commit as one undo operation.
   * @param label - Optional human-readable name for the undo operation.
   * @returns The committed replacement state echoed by the workspace.
   * @throws {Error} when the workspace rejects or cannot persist the edit.
   */
  async apply(intents: FontIntent[], label?: string): Promise<AppliedChange> {
    await this.connect();

    const { applied, documentState } = await this.#require().call("workspace.apply", {
      intents,
      label,
    });
    this.#setDocumentState(documentState);
    return this.#fold(applied);
  }

  /** Replays the latest ledger entry; null when nothing is undoable. */
  async undo(): Promise<AppliedChange | null> {
    await this.connect();

    const { applied, documentState } = await this.#require().call("workspace.undo", undefined);
    this.documentStateCell.set(documentState);
    return applied === null ? null : this.#fold(applied);
  }

  /** Replays the latest undone entry; null when nothing is redoable. */
  async redo(): Promise<AppliedChange | null> {
    await this.connect();

    const { applied, documentState } = await this.#require().call("workspace.redo", undefined);
    this.documentStateCell.set(documentState);
    return applied === null ? null : this.#fold(applied);
  }

  async snapshot(): Promise<WorkspaceSnapshot | null> {
    await this.connect();

    const snapshot = await this.#require().call("workspace.snapshot", undefined);
    this.workspaceCell.set(snapshot);
    return snapshot;
  }

  /** Reads the retained preview directory through the shared session lane. */
  async sourceSnapshot(): Promise<FontSourceSnapshot | null> {
    await this.connect();

    const snapshot = await this.#require().call("source.snapshot", undefined);
    this.sourceCell.set(snapshot);
    return snapshot;
  }

  /** Reads one retained location-independent glyph and its component closure. */
  async sourceGlyph(glyphId: GlyphId): Promise<GlyphSnapshot[]> {
    await this.connect();

    return this.#require().call("source.glyph", { glyphId });
  }

  /** Prepares one retained-source atlas page at dense source coordinates. */
  async prepareSourceAtlasPage(request: FontSourceAtlasPageRequest): Promise<CatalogAtlasPage> {
    await this.connect();

    return this.#require().call("source.atlasPagePrepare", request);
  }

  /** Streams one prepared retained-source page through bounded chunks. */
  async streamSourceAtlasPage(
    generation: number,
    maximumLength: number,
    write: (offset: number, bytes: Uint8Array<ArrayBuffer>) => void,
  ): Promise<number> {
    await this.connect();

    const ports = new MessageChannel();
    const stream = new PortByteStream(domPortTransport(ports.port1));

    try {
      const [, totalLength] = await Promise.all([
        this.#require().call("source.atlasPageStream", { generation, maximumLength }, [
          ports.port2,
        ]),
        stream.receive(write),
      ]);
      return totalLength;
    } finally {
      stream.close();
    }
  }

  /** Releases a retained-source page rejected before streaming. */
  async discardSourceAtlasPage(pageIndex: number, generation: number): Promise<void> {
    await this.connect();

    await this.#require().call("source.atlasPageDiscard", { pageIndex, generation });
  }

  /** Resolves all retained page weights for one dense source location. */
  async sourceAtlasWeights(coordinates: readonly number[]): Promise<CatalogAtlasWeights[]> {
    await this.connect();

    return this.#require().call("source.atlasWeights", { coordinates: [...coordinates] });
  }

  /** Reads utility-owned document state through the renderer sync lane. */
  async documentState(): Promise<WorkspaceDocumentState | null> {
    await this.connect();

    const state = await this.#require().call("document.state", undefined);
    this.documentStateCell.set(state);
    return state;
  }

  /** Saves to the current target; rejects when the document still needs a path. */
  async save(): Promise<WorkspaceDocumentState> {
    await this.connect();

    return this.#setDocumentState(await this.#require().call("workspace.save", undefined));
  }

  /** Saves to `path` and adopts it as the document's target. */
  async saveAs(path: string): Promise<WorkspaceDocumentState> {
    await this.connect();

    return this.#setDocumentState(await this.#require().call("workspace.saveAs", { path }));
  }

  /**
   * Starts compilation after the export request enters the workspace FIFO.
   *
   * @param path - destination selected by the user; must end in `.ttf`.
   * @returns a completion handle so the edit lane can resume after export starts.
   * @throws {Error} when the workspace is disconnected or compilation fails.
   */
  async startExport(path: string): Promise<{ completion: Promise<WorkspaceExportResult> }> {
    await this.connect();

    return {
      completion: this.#require().call("workspace.export", { path }),
    };
  }

  /** Pulls replace-grade glyph snapshots by stable glyph id and exact sources. */
  async glyphSnapshots(
    requests: readonly WorkspaceGlyphSnapshotRequest[],
  ): Promise<GlyphSnapshot[]> {
    await this.connect();

    return this.#require().call("workspace.glyphSnapshots", {
      requests: [...requests],
    });
  }

  /**
   * Reads compact glyph projection models and their component dependencies.
   *
   * @param glyphIds - Stable root glyph identities requested by the caller.
   * @returns Location-independent models suitable for synchronous renderer evaluation.
   */
  async glyphProjections(glyphIds: readonly GlyphId[]): Promise<GlyphProjection[]> {
    await this.connect();

    return this.#require().call("workspace.glyphProjections", {
      glyphIds: [...glyphIds],
    });
  }

  /**
   * Resolves drawable glyph previews at one internal authoring location.
   *
   * @param glyphIds - Stable glyph identities requested by the caller.
   * @param location - Internal location; axis mappings must already be evaluated.
   * @returns One svg path and advance per resolvable glyph; missing ids are omitted.
   */
  async glyphPreviews(glyphIds: readonly GlyphId[], location: Location): Promise<GlyphPreview[]> {
    await this.connect();

    return this.#require().call("workspace.glyphPreviews", {
      glyphIds: [...glyphIds],
      location,
    });
  }

  /** Builds the current authored font's location-independent Slug generation. */
  async prepareSlugAtlas(alignment: number): Promise<SlugAtlas> {
    await this.connect();

    return this.#require().call("workspace.slugAtlasPrepare", { alignment });
  }

  /** Opens or builds one deterministic root-glyph page behind committed edits. */
  async prepareSlugAtlasPage(request: WorkspaceSlugAtlasPageRequest): Promise<WorkspaceSlugAtlas> {
    await this.connect();

    return this.#require().call("workspace.slugAtlasPagePrepare", request);
  }

  /** Writes one prepared Slug generation through bounded, ordered chunks. */
  async streamSlugAtlas(
    generation: number,
    maximumLength: number,
    write: (offset: number, bytes: Uint8Array<ArrayBuffer>) => void,
  ): Promise<number> {
    await this.connect();

    const ports = new MessageChannel();
    const stream = new PortByteStream(domPortTransport(ports.port1));

    try {
      const [, totalLength] = await Promise.all([
        this.#require().call("workspace.slugAtlasStream", { generation, maximumLength }, [
          ports.port2,
        ]),
        stream.receive(write),
      ]);
      return totalLength;
    } finally {
      stream.close();
    }
  }

  /** Writes one prepared page through bounded, ordered chunks. */
  async streamSlugAtlasPage(
    generation: number,
    origin: SlugAtlasOrigin,
    maximumLength: number,
    write: (offset: number, bytes: Uint8Array<ArrayBuffer>) => void,
  ): Promise<number> {
    await this.connect();

    const ports = new MessageChannel();
    const stream = new PortByteStream(domPortTransport(ports.port1));

    try {
      const [, totalLength] = await Promise.all([
        this.#require().call(
          "workspace.slugAtlasPageStream",
          { generation, origin, maximumLength },
          [ports.port2],
        ),
        stream.receive(write),
      ]);
      return totalLength;
    } finally {
      stream.close();
    }
  }

  /** Releases a prepared generation that was rejected before streaming. */
  async discardSlugAtlas(generation: number): Promise<void> {
    await this.connect();

    await this.#require().call("workspace.slugAtlasDiscard", { generation });
  }

  /** Releases a prepared page that was rejected before streaming. */
  async discardSlugAtlasPage(generation: number, origin: SlugAtlasOrigin): Promise<void> {
    await this.connect();

    await this.#require().call("workspace.slugAtlasPageDiscard", { generation, origin });
  }

  /**
   * Evaluates the current font's axis mappings in the utility process.
   *
   * @param location - External location keyed by stable axis id.
   * @returns The mapped location, with omitted axes filled from their defaults.
   */
  async mapLocation(location: Location): Promise<Location> {
    await this.connect();

    return this.#require().call("workspace.mapLocation", location);
  }

  #fold(applied: AppliedChange): AppliedChange {
    const current = this.workspaceCell.peek();
    if (!current) return applied;

    const next = applied.next;
    if (!next) return applied;

    this.workspaceCell.set({
      ...current,
      metadata: next.metadata ?? current.metadata,
      glyphs: next.glyphs ?? current.glyphs,
      axes: next.axes ?? current.axes,
      axisMappings: next.axisMappings ?? current.axisMappings,
      axisMappingBases: next.axisMappingBases ?? current.axisMappingBases,
      namedInstances: next.namedInstances ?? current.namedInstances,
      sources: next.sources ?? current.sources,
    });

    return applied;
  }

  async #connect(): Promise<void> {
    try {
      if (this.#transport) {
        const channel = new Channel<SyncCallMap, SyncEventMap>(await this.#transport());
        this.#installChannel(channel);
        await this.#catchUp(channel);
        return;
      }

      if (!this.#host) {
        throw new Error("FontSessionClient needs a ShiftHost or a transport option");
      }

      // Install the port listener before asking main to post the port.
      const port = this.#nextWorkspacePort();

      try {
        await this.#host.session.connect();
      } catch (error) {
        port.cancel();
        throw error;
      }

      const channel = new Channel<SyncCallMap, SyncEventMap>(domPortTransport(await port.received));
      this.#installChannel(channel);

      // Catch-up pull: covers renderer reattach (Vite hot reload now, crash
      // recovery later). Ports are FIFO, so this cannot overtake a later create.
      await this.#catchUp(channel);
    } catch (error) {
      this.#connection = null;
      throw error;
    }
  }

  async #catchUp(channel: Channel<SyncCallMap, SyncEventMap>): Promise<void> {
    switch (this.#mode) {
      case "authored":
        this.workspaceCell.set(await channel.call("workspace.snapshot", undefined));
        this.documentStateCell.set(await channel.call("document.state", undefined));
        return;
      case "imported":
        this.sourceCell.set(await channel.call("source.snapshot", undefined));
        return;
    }
  }

  #installChannel(channel: Channel<SyncCallMap, SyncEventMap>): void {
    this.#channel = channel;
    channel.listen("document.changed", (state) => {
      this.documentStateCell.set(state);
    });
  }

  #setDocumentState(state: WorkspaceDocumentState): WorkspaceDocumentState {
    this.documentStateCell.set(state);
    return state;
  }

  #nextWorkspacePort(): { received: Promise<MessagePort>; cancel: () => void } {
    let cancel = () => {};

    const received = new Promise<MessagePort>((resolve) => {
      const listener = (event: MessageEvent) => {
        if (event.source !== window) return;
        if ((event.data as { type?: string } | null)?.type !== "session.port") return;

        const port = event.ports[0];
        if (!port) return;

        window.removeEventListener("message", listener);
        resolve(port);
      };

      cancel = () => window.removeEventListener("message", listener);
      window.addEventListener("message", listener);
    });

    return { received, cancel };
  }

  #require(): Channel<SyncCallMap, SyncEventMap> {
    if (!this.#channel) {
      throw new Error("font session is not connected");
    }

    return this.#channel;
  }
}
