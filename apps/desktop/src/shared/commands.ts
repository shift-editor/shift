/**
 * Identifies an app command that can be requested through the Shift host API.
 *
 * Command IDs are shared between renderer-facing UI, native menus, and the main
 * process command registry. The ID is only an identity token; main owns the
 * behavior for each command.
 */
export type CommandId =
  | "file.new"
  | "file.open"
  | "file.save"
  | "file.saveAs"
  | "glyph.reverseSelectedContour"
  | "window.close"
  | "window.minimise"
  | "window.maximise"
  | "ui.zoomIn"
  | "ui.zoomOut"
  | "ui.zoomReset";

/**
 * Identifies a command implemented by the active renderer/editor.
 *
 * Renderer command IDs are sent from main to the focused workspace window.
 * Main owns native menu routing; renderer owns selection interpretation and
 * editor mutation.
 */
export type RendererCommandId = "glyph.reverseSelectedContour";
