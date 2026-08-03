import type { CommandId, RendererCommandId } from "../commands";

/**
 * Renderer-facing API for Electron app-shell behavior.
 *
 * @remarks
 * This is the product API exposed by preload as `window.shiftHost`. Renderer
 * code should depend on this shape instead of Electron's `ipcRenderer` or raw
 * IPC channel names.
 */
export interface ShiftHost {
  /** Runs app commands owned by the main process. */
  commands: {
    /**
     * Requests that main run a registered command.
     *
     * @param id - Command identity from the shared command list.
     * @throws {Error} when the preload bridge is unavailable or main rejects the command.
     */
    run: (id: CommandId) => Promise<void>;
    /**
     * Subscribes to commands that main asks the active renderer to execute.
     *
     * @param callback - receives the renderer-owned command identity.
     * @returns an unsubscribe function.
     */
    onRunRendererCommand: (callback: (id: RendererCommandId) => void) => () => void;
  };
  /** Connects the renderer to main-owned document requests. */
  document: {
    /**
     * Asks main to transfer a document request lane for the sender's workspace.
     *
     * @remarks
     * The renderer half arrives via the `document.port` postMessage relay;
     * install that listener before calling. Main rejects the request when the
     * sender window is not bound to a workspace.
     */
    connect: () => Promise<void>;
  };
  /** Connects the renderer to its selected font-session backend. */
  session: {
    kind: () => Promise<"workspace" | "source">;
    /**
     * Asks main to transfer a fresh sync-lane port to the session process.
     *
     * @remarks
     * The renderer half arrives via the `session.port` postMessage relay.
     */
    connect: () => Promise<void>;
    ready: () => Promise<void>;
  };
  /** App-shell UI events owned by the main process. */
  ui: {
    /**
     * Subscribes to UI (chrome) zoom changes driven by the View menu.
     *
     * @returns an unsubscribe function.
     */
    onZoomChanged: (callback: (percent: number) => void) => () => void;
  };
  /** System clipboard access owned by the app shell. */
  clipboard: {
    writeText: (text: string) => Promise<void>;
    readText: () => Promise<string>;
  };
}
