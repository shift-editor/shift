import type { Command } from "./Command";
import type { CommandRegistry } from "./Command";

const windowCommands: Command[] = [
  {
    id: "window.close",
    label: "Close Window",
    accelerator: "CmdOrCtrl+W",
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => {
      ctx.windows.active()?.close();
    },
  },
  {
    id: "window.minimise",
    label: "Minimise Window",
    accelerator: "CmdOrCtrl+M",
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => {
      ctx.windows.active()?.minimize();
    },
  },
  {
    id: "window.maximise",
    label: "Maximise Window",
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => {
      ctx.windows.active()?.toggleMaximize();
    },
  },
];

const viewCommands: Command[] = [
  {
    id: "ui.zoomIn",
    label: "Zoom In",
    accelerator: "CmdOrCtrl+Plus",
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => {
      ctx.windows.active()?.zoomIn();
    },
  },
  {
    id: "ui.zoomOut",
    label: "Zoom Out",
    accelerator: "CmdOrCtrl+Shift+-",
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => {
      ctx.windows.active()?.zoomOut();
    },
  },
  {
    id: "ui.zoomReset",
    label: "Reset Zoom",
    accelerator: "CmdOrCtrl+0",
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => {
      ctx.windows.active()?.resetZoom();
    },
  },
];

const fileCommands: Command[] = [];
const editCommands: Command[] = [];

/**
 * Snapshot of commands available to the app shell.
 *
 * Group commands by domain above, then compose them here so registration,
 * menus, and future command-palette code read from the same source.
 */
export const commands: Command[] = [
  ...windowCommands,
  ...viewCommands,
  ...fileCommands,
  ...editCommands,
];

/**
 * Registers every app command into the supplied registry.
 *
 * @param registry - Registry that receives the command definitions for this app instance.
 * @throws {Error} when two commands use the same ID.
 */
export function registerCommands(registry: CommandRegistry): void {
  for (const command of commands) {
    registry.register(command);
  }
}
