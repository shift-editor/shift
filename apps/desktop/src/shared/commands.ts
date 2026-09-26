/**
 * Identifies an app command that can be requested through the Shift host API.
 *
 * Command IDs are shared between renderer-facing UI, native menus, and the main
 * process command registry. The ID is only an identity token; main owns the
 * behavior for each command.
 */
export type CommandId =
  | "app.checkForUpdates"
  | "app.showAbout"
  | "app.showSettings"
  | "help.openWebsite"
  | "help.openDiscord"
  | "help.openX"
  | "help.reportIssue"
  | "help.showLogs"
  | "help.emailFeedback"
  | "file.new"
  | "file.open"
  | "file.save"
  | "file.saveAs"
  | "file.exportTtf"
  | "edit.undo"
  | "edit.redo"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.deleteSelection"
  | "edit.duplicate"
  | "edit.selectAll"
  | "edit.deselect"
  | "glyph.addComponent"
  | "glyph.reverseSelectedContour"
  | "glyph.makeFirstPoint"
  | "window.showHome"
  | "window.close"
  | "window.minimise"
  | "window.maximise"
  | "view.zoomIn"
  | "view.zoomOut"
  | "ui.increaseSize"
  | "ui.decreaseSize"
  | "ui.resetSize";

/** Platform-neutral keyboard chord assigned to an application command. */
export interface CommandShortcut {
  readonly key: string;
  readonly primaryModifier: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/** Canonical keyboard shortcuts shared by native menus and renderer routing. */
export const commandShortcuts = {
  "app.showSettings": shortcut(","),
  "window.close": shortcut("w"),
  "window.minimise": shortcut("m"),
  "view.zoomIn": shortcut("+"),
  "view.zoomOut": shortcut("-"),
  "ui.increaseSize": shortcut("+", false, true),
  "ui.decreaseSize": shortcut("-", false, true),
  "ui.resetSize": shortcut("0", false, true),
  "file.new": shortcut("n"),
  "file.open": shortcut("o"),
  "file.save": shortcut("s"),
  "file.saveAs": shortcut("s", true),
  "edit.undo": shortcut("z"),
  "edit.redo": shortcut("z", true),
  "edit.cut": shortcut("x"),
  "edit.copy": shortcut("c"),
  "edit.paste": shortcut("v"),
  "edit.selectAll": shortcut("a"),
  "glyph.addComponent": shortcut("c", true),
} satisfies Partial<Record<CommandId, CommandShortcut>>;

/** Converts a shared command shortcut to Electron's native accelerator syntax. */
export function toElectronAccelerator(shortcut: CommandShortcut): string {
  const parts: string[] = [];
  if (shortcut.primaryModifier) parts.push("CmdOrCtrl");
  if (shortcut.altKey) parts.push("Alt");
  if (shortcut.shiftKey) parts.push("Shift");

  const key = shortcut.key === "+" ? "Plus" : shortcut.key.toUpperCase();
  parts.push(key);

  return parts.join("+");
}

function shortcut(key: string, shiftKey = false, altKey = false): CommandShortcut {
  return { key, primaryModifier: true, shiftKey, altKey };
}

/**
 * Identifies a command implemented by the active font renderer.
 *
 * Renderer command IDs are sent from main to the focused font window. Main
 * owns native menu routing; renderer UI owns the resulting surface or edit.
 */
export type RendererCommandId = EditorCommandId | "app.showSettings" | "glyph.addComponent";

/** Identifies a renderer command that acts on the current editor or text focus. */
export type EditorCommandId =
  | "edit.undo"
  | "edit.redo"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.deleteSelection"
  | "edit.duplicate"
  | "edit.selectAll"
  | "edit.deselect"
  | "view.zoomIn"
  | "view.zoomOut"
  | "glyph.reverseSelectedContour"
  | "glyph.makeFirstPoint";
