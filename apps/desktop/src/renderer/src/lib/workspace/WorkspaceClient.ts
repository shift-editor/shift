import { Channel, domPortTransport, type Transport } from "@shared/workspace/channel";
import type {
  SyncCallMap,
  SyncEventMap,
  WorkspaceDocumentState,
  WorkspaceExportResult,
  WorkspaceGlyphSnapshot,
  WorkspaceGlyphSnapshotRequest,
  WorkspaceSnapshot,
} from "@shared/workspace/protocol";
import type { ShiftHost } from "@shared/host/ShiftHost";
import type { AppliedChange, FontIntent, GlyphId, GlyphPreview, Location } from "@shift/types";
import { signal } from "@/lib/signals/signal";

/**
 * Renderer side of the workspace sync lane.
 *
 * @remarks
 * `workspaceCell` is the renderer's latest workspace summary. `FontStore`
 * owns the renderer-local font model state; this client only
 * transports workspace calls and mirrors the summary for catch-up/recovery.
 */
export type WorkspaceClientOptions = {
  /**
   * Test seam: supplies the sync-lane transport directly (in-process
   * WorkspaceHost over node ports). Production uses the preload port relay.
   */
  transport?: () => Promise<Transport>;
};

export class WorkspaceClient {
  readonly workspaceCell = signal<WorkspaceSnapshot | null>(null);
  readonly documentStateCell = signal<WorkspaceDocumentState | null>(null);

  readonly #host: ShiftHost | null;
  readonly #transport: (() => Promise<Transport>) | null;
  #channel: Channel<SyncCallMap, SyncEventMap> | null = null;
  #connection: Promise<void> | null = null;

  constructor(host: ShiftHost | null, options: WorkspaceClientOptions = {}) {
    this.#host = host;
    this.#transport = options.transport ?? null;
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
    this.documentStateCell.set(null);
  }

  /**
   * Applies an intent set; the response is pure replace-grade state.
   */
  async apply(intents: FontIntent[]): Promise<AppliedChange> {
    await this.connect();

    const { applied, documentState } = await this.#require().call("workspace.apply", { intents });
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
  ): Promise<WorkspaceGlyphSnapshot[]> {
    await this.connect();

    return this.#require().call("workspace.glyphSnapshots", {
      requests: [...requests],
    });
  }

  /**
   * Resolves lightweight glyph projections in the utility workspace.
   *
   * @param glyphIds - Stable glyph identities to resolve in request order.
   * @param location - Internal design location shared by the whole batch.
   * @returns Fresh preview values; missing glyph identities are omitted.
   * @throws {Error} when the workspace is disconnected or native resolution fails.
   */
  async glyphPreviews(glyphIds: readonly GlyphId[], location: Location): Promise<GlyphPreview[]> {
    await this.connect();

    return this.#require().call("workspace.glyphPreviews", {
      glyphIds: [...glyphIds],
      location,
    });
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
      glyphs: next.glyphs ?? current.glyphs,
      axes: next.axes ?? current.axes,
      axisMappings: next.axisMappings ?? current.axisMappings,
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
        this.workspaceCell.set(await channel.call("workspace.snapshot", undefined));
        this.documentStateCell.set(await channel.call("document.state", undefined));
        return;
      }

      if (!this.#host) {
        throw new Error("WorkspaceClient needs a ShiftHost or a transport option");
      }

      // Install the port listener before asking main to post the port.
      const port = this.#nextWorkspacePort();

      try {
        await this.#host.workspace.connect();
      } catch (error) {
        port.cancel();
        throw error;
      }

      const channel = new Channel<SyncCallMap, SyncEventMap>(domPortTransport(await port.received));
      this.#installChannel(channel);

      // Catch-up pull: covers renderer reattach (Vite hot reload now, crash
      // recovery later). Ports are FIFO, so this cannot overtake a later create.
      this.workspaceCell.set(await channel.call("workspace.snapshot", undefined));
      this.documentStateCell.set(await channel.call("document.state", undefined));
    } catch (error) {
      this.#connection = null;
      throw error;
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
        if (event.origin !== window.location.origin) return;
        if ((event.data as { type?: string } | null)?.type !== "workspace.port") return;

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
      throw new Error("workspace is not connected");
    }

    return this.#channel;
  }
}
