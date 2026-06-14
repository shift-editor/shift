import type { CommandId } from "../commands";

/**
 * Tells the renderer to issue a save on its committed-op lane.
 *
 * @remarks
 * `path` is null for Save (current target) and a filesystem path for Save As —
 * main owns the dialog and resolves the path before sending. The renderer
 * enqueues the save behind its edits; main learns the outcome from the
 * utility's `document.changed` event, so this is one-way (no reply channel).
 */
export type DocumentSaveRequest = {
  path: string | null;
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
  /** Main resolved the save path; the renderer issues the save on its edit lane. */
  "document.save": (request: DocumentSaveRequest) => void;
  /** UI (chrome) zoom changed via the View menu or its accelerators. */
  "ui.zoomChanged": (percent: number) => void;
};
