import type { CommandId } from "../commands";

export type DocumentFlushRequest = {
  requestId: string;
};

export type DocumentFlushCompletion = {
  requestId: string;
  error?: string;
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
  "document.flushCompleted": (completion: DocumentFlushCompletion) => void;
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
  /** Main is about to run a document lifecycle operation and needs renderer edits settled. */
  "document.flushRequested": (request: DocumentFlushRequest) => void;
  /** UI (chrome) zoom changed via the View menu or its accelerators. */
  "ui.zoomChanged": (percent: number) => void;
};
