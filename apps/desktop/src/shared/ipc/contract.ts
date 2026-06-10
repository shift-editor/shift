import type { CommandId } from "../commands";

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
 * Keep this empty until main needs to push state or events into the renderer.
 */
export type MainToRenderer = {};
