import type { Command } from "./Command";
import type { CommandRegistry } from "./Command";

const appCommands: Command[] = [
  {
    id: "app.checkForUpdates",
    label: "Check for Updates…",
    run: (ctx) => ctx.update.checkForUpdates(),
  },
  {
    id: "app.showSettings",
    label: "Settings…",
    accelerator: "CmdOrCtrl+,",
    enabled: (ctx) => ctx.renderer.available(),
    run: (ctx) => ctx.renderer.run("app.showSettings"),
  },
];

const windowCommands: Command[] = [
  {
    id: "window.showHome",
    label: "Home",
    run: (ctx) => ctx.windows.showHome(),
  },
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

const fileCommands: Command[] = [
  {
    id: "file.new",
    label: "New Font",
    accelerator: "CmdOrCtrl+N",
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => ctx.document.create(),
  },
  {
    id: "file.open",
    label: "Open…",
    accelerator: "CmdOrCtrl+O",
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => ctx.document.open(),
  },
  {
    id: "file.save",
    label: "Save",
    accelerator: "CmdOrCtrl+S",
    enabled: (ctx) => ctx.document.canSave(),
    run: (ctx) => ctx.document.save(),
  },
  {
    id: "file.saveAs",
    label: "Save As...",
    accelerator: "CmdOrCtrl+Shift+S",
    enabled: (ctx) => ctx.document.canSave(),
    run: (ctx) => ctx.document.saveAs(),
  },
  {
    id: "file.exportTtf",
    label: "TrueType (.ttf)…",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.document.exportTtf(),
  },
];
const editCommands: Command[] = [
  {
    id: "edit.undo",
    label: "Undo",
    accelerator: "CmdOrCtrl+Z",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.undo"),
  },
  {
    id: "edit.redo",
    label: "Redo",
    accelerator: "CmdOrCtrl+Shift+Z",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.redo"),
  },
  {
    id: "edit.cut",
    label: "Cut",
    accelerator: "CmdOrCtrl+X",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.cut"),
  },
  {
    id: "edit.copy",
    label: "Copy",
    accelerator: "CmdOrCtrl+C",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.copy"),
  },
  {
    id: "edit.paste",
    label: "Paste",
    accelerator: "CmdOrCtrl+V",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.paste"),
  },
  {
    id: "edit.deleteSelection",
    label: "Delete",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.deleteSelection"),
  },
  {
    id: "edit.selectAll",
    label: "Select All",
    accelerator: "CmdOrCtrl+A",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.selectAll"),
  },
];

const glyphCommands: Command[] = [
  {
    id: "glyph.reverseSelectedContour",
    label: "Reverse Selected Contour",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => {
      ctx.renderer.run("glyph.reverseSelectedContour");
    },
  },
];

/**
 * Snapshot of commands available to the app shell.
 *
 * Group commands by domain above, then compose them here so registration,
 * menus, and future command-palette code read from the same source.
 */
export const commands: Command[] = [
  ...appCommands,
  ...windowCommands,
  ...viewCommands,
  ...fileCommands,
  ...editCommands,
  ...glyphCommands,
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
