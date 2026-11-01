import { shell } from "electron";
import log from "electron-log/main";
import type { Command, CommandRegistry } from "./Command";
import {
  SHIFT_DISCORD_URL,
  SHIFT_NEW_ISSUE_URL,
  SHIFT_WEBSITE_URL,
  SHIFT_X_URL,
} from "../../shared/links";

const appCommands: Command[] = [
  {
    id: "app.showAbout",
    effect: "app",
    label: "About Shift",
    run: (ctx) => ctx.windows.showAbout(),
  },
  {
    id: "app.checkForUpdates",
    effect: "app",
    label: "Check for Updates…",
    run: (ctx) => ctx.update.checkForUpdates(),
  },
  {
    id: "app.installCommandLineTool",
    effect: "file",
    label: "Install Command Line Tool…",
    enabled: (ctx) => ctx.commandLineTool.available(),
    run: (ctx) => ctx.commandLineTool.install(),
  },
  {
    id: "app.showSettings",
    effect: "view",
    label: "Settings…",
    enabled: (ctx) => ctx.renderer.available(),
    run: (ctx) => ctx.renderer.run("app.showSettings"),
  },
];

const helpCommands: Command[] = [
  {
    id: "help.openWebsite",
    effect: "app",
    label: "Website",
    run: () => shell.openExternal(SHIFT_WEBSITE_URL),
  },
  {
    id: "help.openDiscord",
    effect: "app",
    label: "Discord",
    run: () => shell.openExternal(SHIFT_DISCORD_URL),
  },
  {
    id: "help.openX",
    effect: "app",
    label: "X / Twitter",
    run: () => shell.openExternal(SHIFT_X_URL),
  },
  {
    id: "help.reportIssue",
    effect: "app",
    label: "Report a Problem…",
    run: () => shell.openExternal(SHIFT_NEW_ISSUE_URL),
  },
  {
    id: "help.showLogs",
    effect: "app",
    label: "Show Logs",
    run: () => shell.showItemInFolder(log.transports.file.getFile().path),
  },
  {
    id: "help.emailFeedback",
    effect: "app",
    label: "Feedback…",
    run: (ctx) => ctx.windows.showFeedback(),
  },
];

const windowCommands: Command[] = [
  {
    id: "window.showHome",
    effect: "app",
    label: "Home",
    run: (ctx) => ctx.windows.showHome(),
  },
  {
    // The window's renderer closes its shown tab, or asks for window.close when only
    // the pinned Glyphs tab is left; a window with no renderer to ask closes.
    id: "tab.close",
    effect: "view",
    label: "Close Tab",
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => {
      if (ctx.renderer.available()) {
        ctx.renderer.run("tab.close");
        return;
      }
      ctx.windows.active()?.close();
    },
  },
  {
    id: "window.close",
    effect: "app",
    label: "Close Window",
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => {
      ctx.windows.active()?.close();
    },
  },
  {
    id: "window.minimise",
    effect: "app",
    label: "Minimise Window",
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => {
      ctx.windows.active()?.minimize();
    },
  },
  {
    id: "window.maximise",
    effect: "app",
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
    effect: "view",
    label: "Zoom In",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("view.zoomIn"),
  },
  {
    id: "view.zoomOut",
    effect: "view",
    label: "Zoom Out",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("view.zoomOut"),
  },
  {
    id: "ui.increaseSize",
    effect: "view",
    label: "Increase Interface Size",
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => {
      ctx.windows.active()?.increaseInterfaceSize();
    },
  },
  {
    id: "ui.decreaseSize",
    effect: "view",
    label: "Decrease Interface Size",
    enabled: (ctx) => ctx.windows.active() !== null,
    run: (ctx) => {
      ctx.windows.active()?.decreaseInterfaceSize();
    },
  },
  {
    id: "ui.resetSize",
    effect: "view",
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
    effect: "file",
    label: "New Font",
    run: (ctx) => ctx.document.create(),
  },
  {
    id: "file.open",
    effect: "file",
    label: "Open…",
    run: (ctx) => ctx.document.open(),
  },
  {
    id: "file.openFolder",
    effect: "file",
    label: "Open Font Folder…",
    // macOS opens packages from Open…, which selects files and folders together.
    enabled: () => process.platform !== "darwin",
    run: (ctx) => ctx.document.openFolder(),
  },
  {
    id: "file.save",
    effect: "file",
    label: "Save",
    enabled: (ctx) => ctx.document.canSave(),
    run: (ctx) => ctx.document.save(),
  },
  {
    id: "file.saveAs",
    effect: "file",
    label: "Save As...",
    enabled: (ctx) => ctx.document.canSave(),
    run: (ctx) => ctx.document.saveAs(),
  },
  {
    id: "file.exportTtf",
    effect: "file",
    label: "TrueType (.ttf)…",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.document.exportTtf(),
  },
];
const editCommands: Command[] = [
  {
    id: "edit.undo",
    // Undo and Redo replay font edits, so they count as font edits themselves.
    effect: "font",
    label: "Undo",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.undo"),
  },
  {
    id: "edit.redo",
    effect: "font",
    label: "Redo",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.redo"),
  },
  {
    id: "edit.cut",
    effect: "font",
    label: "Cut",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.cut"),
  },
  {
    id: "edit.copy",
    // Writes the system clipboard, which other apps read.
    effect: "app",
    label: "Copy",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.copy"),
  },
  {
    id: "edit.paste",
    effect: "font",
    label: "Paste",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.paste"),
  },
  {
    id: "edit.deleteSelection",
    effect: "font",
    label: "Delete",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.deleteSelection"),
  },
  {
    id: "edit.duplicate",
    effect: "font",
    label: "Duplicate",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.duplicate"),
  },
  {
    id: "edit.selectAll",
    effect: "view",
    label: "Select All",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.selectAll"),
  },
  {
    id: "edit.deselect",
    effect: "view",
    label: "Deselect",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("edit.deselect"),
  },
];

const glyphCommands: Command[] = [
  {
    id: "glyph.addComponent",
    effect: "font",
    label: "Add Component…",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("glyph.addComponent"),
  },
  {
    id: "glyph.addAnchor",
    effect: "font",
    label: "Add Anchor",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("glyph.addAnchor"),
  },
  {
    id: "glyph.decomposeComponents",
    effect: "font",
    label: "Decompose Components",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("glyph.decomposeComponents"),
  },
  {
    id: "glyph.makeFirstPoint",
    effect: "font",
    label: "Make First Point",
    enabled: (ctx) => ctx.document.hasWorkspace(),
    run: (ctx) => ctx.renderer.run("glyph.makeFirstPoint"),
  },
  {
    id: "glyph.reverseSelectedContour",
    effect: "font",
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
