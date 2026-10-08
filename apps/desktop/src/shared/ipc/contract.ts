import type { CommandId, RendererCommandId } from "../commands";
import type {
  FontSessionMode,
  WorkspaceDocumentState,
  WorkspaceExportResult,
} from "../workspace/protocol";
import type { UpdateProgress } from "../update/types";
import type { RecentDocument } from "../recents";
import type { AgentConnectionsState, CommandLineToolState } from "../agent/connections";
import type { MenuBar, TitleBarColors, WindowButtonLayout } from "../menu/types";

export type DocumentCallMap = {
  "document.state": { request: void; response: WorkspaceDocumentState | null };
  "document.save": {
    request: { path: string | null };
    response: WorkspaceDocumentState;
  };
  "document.export": {
    request: { path: string };
    response: WorkspaceExportResult;
  };
};

export type DocumentEventMap = Record<string, never>;

export type RendererErrorReport = {
  productVersion: string | null;
  buildCommit: string | null;
  route: string;
  boundaryName: string;
  message: string;
  stack: string | null;
  componentStack?: string;
};

/**
 * Defines request/response channels that the renderer may invoke on main.
 *
 * @remarks
 * This is the private transport contract underneath the Shift host API. Add
 * channels here only when preload needs a new main-process capability.
 */
export type RendererToMain = {
  "agent.connect": () => void;
  "agentConnections.state": () => AgentConnectionsState;
  /** Persists whether local agents may connect and starts or stops the MCP server. */
  "agentConnections.setAllowed": (allowed: boolean) => AgentConnectionsState;
  "commandLineTool.state": () => CommandLineToolState;
  /** Puts the bundled shift-cli on PATH, prompting for admin rights when needed. */
  "commandLineTool.install": () => CommandLineToolState;
  "commands.run": (id: CommandId) => void;
  "clipboard.readText": () => string;
  "clipboard.writeText": (text: string) => void;
  /**
   * Asks main to transfer a document request lane to the renderer. The port
   * arrives separately on the `document.port` postMessage channel because ports
   * cannot travel through `invoke` responses.
   */
  "document.connect": () => void;
  /** Returns the backend capability selected for the sender's font session. */
  "session.mode": () => Exclude<FontSessionMode, "memory">;
  /**
   * Asks main to wire a sync lane to the font session process. The port itself
   * arrives separately on the `session.port` postMessage channel because ports
   * cannot travel through `invoke` responses.
   */
  "session.connect": () => void;
  "session.ready": () => void;
  "window.reopenDocument": () => void;
  /** Reports that the sender's first meaningful content is rendered, so main can show it. */
  "window.ready": () => void;
  /** Recolours the native window controls drawn over the sender's title bar (Windows and Linux). */
  "window.setTitleBarColors": (colors: TitleBarColors) => void;
  /** Returns the desktop's window-button layout on Linux, or null where the system draws them. */
  "window.buttonLayout": () => WindowButtonLayout | null;
  /** Returns the Windows and Linux menus for the sender's menu bar; empty on macOS. */
  "menu.bar": () => MenuBar;
  /** Runs a menu bar item for the sender window, as the native menu would. */
  "menu.activate": (itemId: string) => void;
  "errors.reportRenderer": (report: RendererErrorReport) => void;
  "update.startDownload": () => void;
  "update.cancelDownload": () => void;
  "update.restartToUpdate": () => void;
  "update.later": () => void;
  "recents.list": () => RecentDocument[];
  /** Opens a recent file from the sender window, replacing it when it is the launcher. */
  "recents.open": (path: string) => void;
  /** Returns the removed entry so the renderer can offer undo. */
  "recents.remove": (path: string) => RecentDocument | null;
  "recents.restore": (document: RecentDocument) => void;
  "recents.reveal": (path: string) => void;
  /** Asks for the new location of a missing file, opens it, and drops the stale entry. */
  "recents.locate": (path: string) => void;
};

/**
 * Defines broadcast channels that main may send to renderer windows.
 *
 * @remarks
 * Add channels here only when main owns the state change and the renderer
 * merely reflects it.
 */
export type MainToRenderer = {
  /** Requests that the active renderer run an editor-owned command. */
  "commands.runRenderer": (id: RendererCommandId) => void;
  /** Interface size changed via the View menu or its accelerators. */
  "ui.zoomChanged": (percent: number) => void;
  /** Reports that an application update is available to download. */
  "update.available": (version: string) => void;
  /** Reports cumulative progress for the active application update download. */
  "update.progress": (progress: UpdateProgress) => void;
  /** Reports that the downloaded application version can be installed. */
  "update.ready": (version: string) => void;
  /** Agent connections were allowed or disallowed, failed to start, or saw a request. */
  "agentConnections.changed": (state: AgentConnectionsState) => void;
  /** Recent files changed after an open, Save As, removal, or Clear Menu. */
  "recents.changed": (documents: RecentDocument[]) => void;
  /** The Windows and Linux menus changed: rebuilt, or command states re-evaluated. */
  "menu.barChanged": (bar: MenuBar) => void;
};
