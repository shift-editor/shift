import { shell } from "electron";
import log from "electron-log/main";
import type { Command } from "./Command";
import type { CommandRegistry } from "./Command";
import {
  SHIFT_DISCORD_URL,
  SHIFT_NEW_ISSUE_URL,
  SHIFT_WEBSITE_URL,
  SHIFT_X_URL,
} from "../../shared/links";

const appCommands: Command[] = [
  {
    id: "app.showAbout",
    label: "About Shift",
    run: (ctx) => ctx.windows.showAbout(),
  },
  {
    id: "app.checkForUpdates",
    label: "Check for Updates…",
    run: (ctx) => ctx.update.checkForUpdates(),
  },
  {
    id: "app.showSettings",
    label: "Settings…",
    enabled: (ctx) => ctx.renderer.available(),
    run: (ctx) => ctx.renderer.run("app.showSettings"),
  },
];

const helpCommands: Command[] = [
  {
    id: "help.openWebsite",
    label: "Website",
    run: () => shell.openExternal(SHIFT_WEBSITE_URL),
  },
  {
    id: "help.openDiscord",
    label: "Discord",
    run: () => shell.openExternal(SHIFT_DISCORD_URL),
  },
  {
    id: "help.openX",
    label: "X / Twitter",
    run: () => shell.openExternal(SHIFT_X_URL),
  },
  {
    id: "help.reportIssue",
    label: "Report a Problem…",
    run: () => shell.openExternal(SHIFT_NEW_ISSUE_URL),
  },
  {
    id: "help.showLogs",
    label: "Show Logs",
    run: () => shell.showItemInFolder(log.transports.file.getFile().path),
  },
  {
    id: "help.emailFeedback",
    label: "Feedback…",
    run: (ctx) => ctx.windows.showFeedback(),
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
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => {
      ctx.windows.active()?.close();
    },
  },
  {
    id: "window.minimise",
    label: "Minimise Window",
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
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("view.zoomIn"),
  },
  {
    id: "view.zoomOut",
    label: "Zoom Out",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("view.zoomOut"),
  },
  {
    id: "ui.increaseSize",
    label: "Increase Interface Size",
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => {
      ctx.windows.active()?.increaseInterfaceSize();
    },
  },
  {
    id: "ui.decreaseSize",
    label: "Decrease Interface Size",
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => {
      ctx.windows.active()?.decreaseInterfaceSize();
    },
  },
  {
    id: "ui.resetSize",
    label: "Reset Interface Size",
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
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => ctx.document.create(),
  },
  {
    id: "file.open",
    label: "Open…",
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => ctx.document.open(),
  },
  {
    id: "file.save",
    label: "Save",
    enabled: (ctx) => ctx.document.canSave(),
    run: (ctx) => ctx.document.save(),
  },
  {
    id: "file.saveAs",
    label: "Save As...",
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
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.undo"),
  },
  {
    id: "edit.redo",
    label: "Redo",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.redo"),
  },
  {
    id: "edit.cut",
    label: "Cut",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.cut"),
  },
  {
    id: "edit.copy",
    label: "Copy",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.copy"),
  },
  {
    id: "edit.paste",
    label: "Paste",
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
    id: "glyph.addComponent",
    label: "Add Component…",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("glyph.addComponent"),
  },
  {
    id: "glyph.makeFirstPoint",
    label: "Make First Point",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("glyph.makeFirstPoint"),
  },
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
