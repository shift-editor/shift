/**
 * Identifies an app command that can be requested through the Shift host API.
 *
 * Command IDs are shared between renderer-facing UI, native menus, and the main
 * process command registry. The ID is only an identity token; main owns the
 * behavior for each command.
 */
export type CommandId =
  | "window.close"
  | "window.minimise"
  | "window.maximise"
  | "ui.zoomIn"
  | "ui.zoomOut"
  | "ui.zoomReset";
