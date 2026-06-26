import { Channel, domPortTransport, type Transport } from "@shared/workspace/channel";
import type {
  SyncCallMap,
  SyncEventMap,
  WorkspaceDocumentState,
  WorkspaceSnapshot,
} from "@shared/workspace/protocol";
import type { ShiftHost } from "@shared/host/ShiftHost";
import type { AppliedChange, FontIntent, GlyphState, LayerId } from "@shift/types";
import { signal } from "@/lib/signals/signal";

/**
 * Renderer side of the workspace sync lane.
 *
 * @remarks
 * `workspaceCell` is the renderer's single source of workspace truth; every
 * sync-lane response is the next state. `null` currently conflates
 * disconnected/empty/crashed — it becomes a tagged union when recovery lands,
 * so do not derive connectedness from it.
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
   *
   * @remarks
   * The record fold happens here (directory follows `$workspace`); layer
   * folds belong to the glyph model and land with the CS3 WorkspaceEditCoordinator —
   * callers receive the AppliedChange to fold geometry themselves until then.
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

  /** Pulls replace-grade glyph state by stable layer id. */
  async layer(layerId: LayerId): Promise<GlyphState | null> {
    await this.connect();

    return this.#require().call("workspace.layer", { layerId });
  }

  #fold(applied: AppliedChange): AppliedChange {
    const current = this.workspaceCell.peek();
    if (!current) return applied;

    if (applied.glyphs || applied.axes || applied.sources) {
      this.workspaceCell.set({
        ...current,
        glyphs: applied.glyphs ?? current.glyphs,
        axes: applied.axes ?? current.axes,
        sources: applied.sources ?? current.sources,
      });
    }

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
