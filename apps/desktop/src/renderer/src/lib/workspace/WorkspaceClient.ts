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
 * `$workspace` is the renderer's single source of workspace truth; every
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
  readonly $workspace = signal<WorkspaceSnapshot | null>(null);

  readonly #host: ShiftHost | null;
  readonly #transport: (() => Promise<Transport>) | null;
  #channel: Channel<SyncCallMap, SyncEventMap> | null = null;
  #connected: Promise<void> | null = null;

  constructor(host: ShiftHost | null, options: WorkspaceClientOptions = {}) {
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

  /** Creates an untitled workspace; `$workspace` becomes the returned state. */
  async create(): Promise<void> {
    await this.connected();

    this.$workspace.set(await this.#require().call("workspace.create", undefined));
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

    return this.#fold(await this.#require().call("workspace.apply", { intents }));
  }

  /** Replays the latest ledger entry; null when nothing is undoable. */
  async undo(): Promise<AppliedChange | null> {
    await this.connected();

    const applied = await this.#require().call("workspace.undo", undefined);
    return applied === null ? null : this.#fold(applied);
  }

  /** Replays the latest undone entry; null when nothing is redoable. */
  async redo(): Promise<AppliedChange | null> {
    await this.connected();

    const applied = await this.#require().call("workspace.redo", undefined);
    return applied === null ? null : this.#fold(applied);
  }

  async open(path: string): Promise<WorkspaceSnapshot> {
    await this.connected();

    const snapshot = await this.#require().call("workspace.open", { path });
    this.$workspace.set(snapshot);
    return snapshot;
  }

  /** Reads utility-owned document state through the renderer sync lane. */
  async documentState(): Promise<WorkspaceDocumentState | null> {
    await this.connected();

    return this.#require().call("document.state", undefined);
  }

  /** Saves to the current target; rejects when the document still needs a path. */
  async save(): Promise<WorkspaceDocumentState> {
    await this.connected();

    return this.#require().call("workspace.save", undefined);
  }

  /** Saves to `path` and adopts it as the document's target. */
  async saveAs(path: string): Promise<WorkspaceDocumentState> {
    await this.connected();

    return this.#require().call("workspace.saveAs", { path });
  }

  /** Pulls replace-grade glyph state (resync + editor open); id-addressed. */
  async glyph(glyphId: GlyphId, sourceId: SourceId): Promise<GlyphState | null> {
    await this.connected();

    return this.#require().call("workspace.glyph", { glyphId, sourceId });
  }

  #fold(applied: AppliedChange): AppliedChange {
    const current = this.$workspace.peek();
    if (!current) return applied;

    if (applied.glyphs || applied.axes || applied.sources) {
      this.$workspace.set({
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
      this.#channel = new Channel<SyncCallMap, SyncEventMap>(await this.#transport());
      this.$workspace.set(await this.#channel.call("workspace.snapshot", undefined));
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

    this.#channel = new Channel<SyncCallMap, SyncEventMap>(domPortTransport(await port.received));

    // Catch-up pull: covers renderer reattach (Vite hot reload now, crash
    // recovery later). Ports are FIFO, so this cannot overtake a later create.
    this.$workspace.set(await this.#channel.call("workspace.snapshot", undefined));
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
