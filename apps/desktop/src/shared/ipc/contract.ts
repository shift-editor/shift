import type { CommandId, RendererCommandId } from "../commands";
import type {
  FontSessionMode,
  WorkspaceDocumentState,
  WorkspaceExportResult,
} from "../workspace/protocol";
import type { UpdateProgress } from "../update/types";

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
  "commands.run": (id: CommandId) => void;
  "menu.showCanvasContextMenu": () => void;
  "clipboard.readText": () => string;
  "clipboard.writeText": (text: string) => void;
  /**
   * Asks main to transfer a document request lane to the renderer. The port
   * arrives separately on the `document.port` postMessage channel because ports
   * cannot travel through `invoke` responses.
   */
  "document.connect": () => void;
  /** Returns the backend capability selected for the sender's font session. */
  "session.mode": () => FontSessionMode;
  /**
   * Asks main to wire a sync lane to the font session process. The port itself
   * arrives separately on the `session.port` postMessage channel because ports
   * cannot travel through `invoke` responses.
   */
  "session.connect": () => void;
  "session.ready": () => void;
  "window.reopenDocument": () => void;
  "errors.reportRenderer": (report: RendererErrorReport) => void;
  "update.startDownload": () => void;
  "update.cancelDownload": () => void;
  "update.restartToUpdate": () => void;
  "update.later": () => void;
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
};
