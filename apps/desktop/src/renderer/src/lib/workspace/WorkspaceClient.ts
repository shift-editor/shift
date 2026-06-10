import { Channel, domPortTransport } from "@shared/workspace/channel";
import type { SyncCallMap, SyncEventMap, WorkspaceSnapshot } from "@shared/workspace/protocol";
import type { ShiftHost } from "@shared/host/ShiftHost";
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
export class WorkspaceClient {
  readonly $workspace = signal<WorkspaceSnapshot | null>(null);

  readonly #host: ShiftHost;
  #channel: Channel<SyncCallMap, SyncEventMap> | null = null;
  #connected: Promise<void> | null = null;

  constructor(host: ShiftHost) {
    this.#host = host;
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

  async #connect(): Promise<void> {
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
