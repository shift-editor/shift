import type { CommandId } from "../commands";

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
  /** Connects the renderer to the workspace utility process. */
  workspace: {
    /**
     * Requests a new untitled workspace in a new bound renderer window.
     */
    create: () => Promise<void>;
    /**
     * Requests that main show an open dialog and open the result in a new bound window.
     */
    open: () => Promise<void>;
    /**
     * Asks main to transfer a fresh sync-lane port to the workspace process.
     *
     * @remarks
     * The lane's renderer half arrives via the `workspace.port` postMessage
     * relay; install that listener before calling. Main resolves the workspace
     * from the sender window.
     */
    connect: () => Promise<void>;
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
  /** System clipboard access (Electron's clipboard module, no IPC). */
  clipboard: {
    writeText: (text: string) => void;
    readText: () => string;
  };
}
