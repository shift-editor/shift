import { Channel, domPortTransport, type Transport } from "@shared/workspace/channel";
import type {
  SyncCallMap,
  SyncEventMap,
  WorkspaceDocumentState,
  WorkspaceSnapshot,
} from "@shared/workspace/protocol";
import type { ShiftHost } from "@shared/host/ShiftHost";
import type { AppliedChange, FontIntent, GlyphId, GlyphState, SourceId } from "@shift/types";
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
export type WorkspaceSessionOptions = {
  /**
   * Test seam: supplies the sync-lane transport directly (in-process
   * WorkspaceHost over node ports). Production uses the preload port relay.
   */
  transport?: () => Promise<Transport>;
};

export class WorkspaceSession {
  readonly workspaceCell = signal<WorkspaceSnapshot | null>(null);
  readonly documentStateCell = signal<WorkspaceDocumentState | null>(null);

  readonly #host: ShiftHost | null;
  readonly #transport: (() => Promise<Transport>) | null;
  #channel: Channel<SyncCallMap, SyncEventMap> | null = null;
  #connected: Promise<void> | null = null;

  constructor(host: ShiftHost | null, options: WorkspaceSessionOptions = {}) {
    this.#host = host;
    this.#transport = options.transport ?? null;
  }

  /**
   * Memoized connection to the workspace process; safe to call repeatedly.
   *
   * @remarks
   * A failed attempt clears the memo so the next call retries instead of
   * re-awaiting a cached rejection for the rest of the session.
   */
  connected(): Promise<void> {
    if (!this.#connected) {
      const attempt = this.#connect();
      this.#connected = attempt;
      attempt.catch(() => {
        if (this.#connected === attempt) this.#connected = null;
      });
    }

    return this.#connected;
  }

  /** Creates an untitled workspace; `workspaceCell` becomes the returned state. */
  async create(): Promise<void> {
    await this.connected();

    this.workspaceCell.set(await this.#require().call("workspace.create", undefined));
  }

  /**
   * Applies an intent set; the response is pure replace-grade state.
   *
   * @remarks
   * The record fold happens here (directory follows `$workspace`); layer
   * folds belong to the glyph model and land with the CS3 WorkspaceEditQueue —
   * callers receive the AppliedChange to fold geometry themselves until then.
   */
  async apply(intents: FontIntent[]): Promise<AppliedChange> {
    await this.connected();

    const { applied, documentState } = await this.#require().call("workspace.apply", { intents });
    this.#setDocumentState(documentState);
    return this.#fold(applied);
  }

  /** Replays the latest ledger entry; null when nothing is undoable. */
  async undo(): Promise<AppliedChange | null> {
    await this.connected();

    const { applied, documentState } = await this.#require().call("workspace.undo", undefined);
    this.documentStateCell.set(documentState);
    return applied === null ? null : this.#fold(applied);
  }

  /** Replays the latest undone entry; null when nothing is redoable. */
  async redo(): Promise<AppliedChange | null> {
    await this.connected();

    const { applied, documentState } = await this.#require().call("workspace.redo", undefined);
    this.documentStateCell.set(documentState);
    return applied === null ? null : this.#fold(applied);
  }

  async open(path: string): Promise<WorkspaceSnapshot> {
    await this.connected();

    const snapshot = await this.#require().call("workspace.open", { path });
    this.workspaceCell.set(snapshot);
    return snapshot;
  }

  /** Reads utility-owned document state through the renderer sync lane. */
  async documentState(): Promise<WorkspaceDocumentState | null> {
    await this.connected();

    const state = await this.#require().call("document.state", undefined);
    this.documentStateCell.set(state);
    return state;
  }

  /** Saves to the current target; rejects when the document still needs a path. */
  async save(): Promise<WorkspaceDocumentState> {
    await this.connected();

    return this.#setDocumentState(await this.#require().call("workspace.save", undefined));
  }

  /** Saves to `path` and adopts it as the document's target. */
  async saveAs(path: string): Promise<WorkspaceDocumentState> {
    await this.connected();

    return this.#setDocumentState(await this.#require().call("workspace.saveAs", { path }));
  }

  /** Pulls replace-grade glyph state (resync + editor open); id-addressed. */
  async glyph(glyphId: GlyphId, sourceId: SourceId): Promise<GlyphState | null> {
    await this.connected();

    return this.#require().call("workspace.glyph", { glyphId, sourceId });
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
    if (this.#transport) {
      const channel = new Channel<SyncCallMap, SyncEventMap>(await this.#transport());
      this.#installChannel(channel);
      this.workspaceCell.set(await channel.call("workspace.snapshot", undefined));
      this.documentStateCell.set(await channel.call("document.state", undefined));
      return;
    }

    if (!this.#host) {
      throw new Error("WorkspaceSession needs a ShiftHost or a transport option");
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
