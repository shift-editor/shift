import type { CommandId, RendererCommandId } from "../commands";
import type { UpdateProgress } from "../update/types";
import type { RendererErrorReport } from "../ipc/contract";
import type { FontSessionMode } from "../workspace/protocol";
import type { RecentDocument } from "../recents";
import type { AgentConnectionsState } from "../agent/connections";

/**
 * Renderer-facing API for Electron app-shell behavior.
 *
 * @remarks
 * This is the product API exposed by preload as `window.shiftHost`. Renderer
 * code should depend on this shape instead of Electron's `ipcRenderer` or raw
 * IPC channel names.
 */
export interface ShiftHost {
  /** Operating system that owns the current application window. */
  platform: NodeJS.Platform;
  /** Connects this renderer to main-owned live agent requests. */
  agent: {
    connect: () => Promise<void>;
  };
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
    mode: () => Promise<Exclude<FontSessionMode, "memory">>;
    /**
     * Asks main to transfer a fresh sync-lane port to the session process.
     *
     * @remarks
     * The renderer half arrives via the `session.port` postMessage relay.
     */
    connect: () => Promise<void>;
    ready: () => Promise<void>;
  };
  /** Controls and observes the main-owned application update flow. */
  update: {
    /** Starts downloading the available update and opens its progress view. */
    startDownload: () => Promise<void>;
    /** Cancels the active update download and closes its progress window. */
    cancelDownload: () => Promise<void>;
    /** Restarts the application after document confirmation and installs the ready update. */
    restartToUpdate: () => Promise<void>;
    /** Closes the ready prompt while retaining the downloaded update. */
    later: () => Promise<void>;
    /**
     * Subscribes to cumulative update download progress.
     *
     * @param callback - receives the latest byte counts, speed, and percentage.
     * @returns an unsubscribe function.
     */
    onProgress: (callback: (progress: UpdateProgress) => void) => () => void;
    /**
     * Subscribes to available update versions.
     *
     * @param callback - receives the product version available to download.
     * @returns an unsubscribe function.
     */
    onAvailable: (callback: (version: string) => void) => () => void;
    /**
     * Subscribes to update download completion.
     *
     * @param callback - receives the downloaded product version.
     * @returns an unsubscribe function.
     */
    onReady: (callback: (version: string) => void) => () => void;
  };
  /** Native window operations owned by the main process. */
  window: {
    /** Reconstructs this document renderer without clearing recovery state. */
    reopenDocument: () => Promise<void>;
    /**
     * Tells main this window has rendered its content and can be shown.
     *
     * @remarks
     * Windows that main creates hidden, such as the launcher, appear on this
     * signal instead of on first paint; repeated calls are ignored.
     */
    ready: () => Promise<void>;
  };
  /** Privacy-safe renderer diagnostics reported to the main log. */
  errors: {
    reportRenderer: (report: RendererErrorReport) => Promise<void>;
  };
  /** App-shell UI events owned by the main process. */
  ui: {
    /**
     * Subscribes to interface-size changes driven by the View menu.
     *
     * @returns an unsubscribe function.
     */
    onZoomChanged: (callback: (percent: number) => void) => () => void;
  };
  /** Whether local agents may connect over MCP, and what they are doing. */
  agentConnections: {
    state: () => Promise<AgentConnectionsState>;
    /** Allows or disallows agent connections; resolves with the resulting state. */
    setAllowed: (allowed: boolean) => Promise<AgentConnectionsState>;
    /**
     * Subscribes to agent connection changes.
     *
     * @returns an unsubscribe function.
     */
    onChanged: (callback: (state: AgentConnectionsState) => void) => () => void;
  };
  /** Main-owned list of files Shift has opened. */
  recents: {
    /** Returns recent files, newest first, with a fresh missing-file check. */
    list: () => Promise<RecentDocument[]>;
    /**
     * Opens a recent file from this window.
     *
     * @remarks
     * Main shows a native failure message when the file cannot be opened.
     */
    open: (path: string) => Promise<void>;
    /**
     * Removes one file from recents.
     *
     * @returns the removed entry for {@link restore}, or null when it was already gone.
     */
    remove: (path: string) => Promise<RecentDocument | null>;
    /** Puts a removed entry back in its original time order. */
    restore: (document: RecentDocument) => Promise<void>;
    /** Shows the file in Finder or the platform file manager. */
    reveal: (path: string) => Promise<void>;
    /** Asks for the new location of a missing file and opens it. */
    locate: (path: string) => Promise<void>;
    /**
     * Subscribes to recent-file changes.
     *
     * @returns an unsubscribe function.
     */
    onChanged: (callback: (documents: RecentDocument[]) => void) => () => void;
  };
  /** System clipboard access owned by the app shell. */
  clipboard: {
    writeText: (text: string) => Promise<void>;
    readText: () => Promise<string>;
  };
}
