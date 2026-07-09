import type { CommandId, RendererCommandId } from "../commands";
import type { WorkspaceDocumentState } from "../workspace/protocol";

export type DocumentCallMap = {
  "document.state": { request: void; response: WorkspaceDocumentState | null };
  "document.save": { request: { path: string | null }; response: WorkspaceDocumentState };
};

export type DocumentEventMap = Record<string, never>;

/**
 * Defines request/response channels that the renderer may invoke on main.
 *
 * @remarks
 * This is the private transport contract underneath the Shift host API. Add
 * channels here only when preload needs a new main-process capability.
 */
export type RendererToMain = {
  "commands.run": (id: CommandId) => void;
  "clipboard.readText": () => string;
  "clipboard.writeText": (text: string) => void;
  /**
   * Asks main to transfer a document request lane to the renderer. The port
   * arrives separately on the `document.port` postMessage channel because ports
   * cannot travel through `invoke` responses.
   */
  "document.connect": () => void;
  /**
   * Asks main to wire a sync lane to the workspace process. The port itself
   * arrives separately on the `workspace.port` postMessage channel because
   * ports cannot travel through `invoke` responses.
   */
  "workspace.connect": () => void;
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
  /** UI (chrome) zoom changed via the View menu or its accelerators. */
  "ui.zoomChanged": (percent: number) => void;
};
