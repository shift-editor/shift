import type { CommandId } from "../commands";
import type { DocumentSaveRequest } from "../ipc/contract";

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
  /** Narrow document lifecycle hooks owned by main. */
  document: {
    /**
     * Subscribes to main's request to save; the renderer issues the save on its
     * committed-op lane so it lands behind pending edits.
     *
     * @returns an unsubscribe function.
     */
    onSave: (callback: (request: DocumentSaveRequest) => void) => () => void;
  };
  /** Connects the renderer to the workspace utility process. */
  workspace: {
    /**
     * Asks main to transfer a fresh sync-lane port to the workspace process.
     *
     * @remarks
     * The lane's renderer half arrives via the `workspace.port` postMessage
     * relay; install that listener before calling.
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
