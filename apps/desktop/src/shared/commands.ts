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
  | "glyph.reverseSelectedContour"
  | "window.showHome"
  | "window.close"
  | "window.minimise"
  | "window.maximise"
  | "view.zoomIn"
  | "view.zoomOut"
  | "ui.increaseSize"
  | "ui.decreaseSize"
  | "ui.resetSize";

/**
 * Identifies a command implemented by the active font renderer.
 *
 * Renderer command IDs are sent from main to the focused font window. Main
 * owns native menu routing; renderer UI owns the resulting surface or edit.
 */
export type RendererCommandId = EditorCommandId | "app.showSettings";

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
  | "glyph.reverseSelectedContour";
