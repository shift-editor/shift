import { shell } from "electron";
import type { Command } from "./Command";
import type { CommandRegistry } from "./Command";

const SHIFT_WEBSITE_URL = "https://shift.graphics/";
const SHIFT_DISCORD_URL = "https://discord.gg/582FxBdNH7";
const SHIFT_X_URL = "https://x.com/kostyafarber_";
const SHIFT_NEW_ISSUE_URL = "https://github.com/shift-editor/shift/issues/new";

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

const helpCommands: Command[] = [
  {
    id: "help.openWebsite",
    label: "Shift Website",
    run: () => shell.openExternal(SHIFT_WEBSITE_URL),
  },
  {
    id: "help.openDiscord",
    label: "Join the Shift Discord",
    run: () => shell.openExternal(SHIFT_DISCORD_URL),
  },
  {
    id: "help.openX",
    label: "Follow Kostya on X",
    run: () => shell.openExternal(SHIFT_X_URL),
  },
  {
    id: "help.reportIssue",
    label: "Report an Issue…",
    run: () => shell.openExternal(SHIFT_NEW_ISSUE_URL),
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
    id: "view.zoomIn",
    label: "Zoom In",
    accelerator: "CmdOrCtrl+Plus",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("view.zoomIn"),
  },
  {
    id: "view.zoomOut",
    label: "Zoom Out",
    accelerator: "CmdOrCtrl+-",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("view.zoomOut"),
  },
  {
    id: "ui.increaseSize",
    label: "Increase Interface Size",
    accelerator: "CmdOrCtrl+Alt+Plus",
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => {
      ctx.windows.active()?.increaseInterfaceSize();
    },
  },
  {
    id: "ui.decreaseSize",
    label: "Decrease Interface Size",
    accelerator: "CmdOrCtrl+Alt+-",
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => {
      ctx.windows.active()?.decreaseInterfaceSize();
    },
  },
  {
    id: "ui.resetSize",
    label: "Reset Interface Size",
    accelerator: "CmdOrCtrl+Alt+0",
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => {
      ctx.windows.active()?.resetInterfaceSize();
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
    id: "edit.duplicate",
    label: "Duplicate",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.duplicate"),
  },
  {
    id: "edit.selectAll",
    label: "Select All",
    accelerator: "CmdOrCtrl+A",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.selectAll"),
  },
  {
    id: "edit.deselect",
    label: "Deselect",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.deselect"),
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
  ...helpCommands,
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
