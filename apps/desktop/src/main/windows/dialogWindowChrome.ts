import type { BrowserWindowConstructorOptions } from "electron";

/** Height of the close-only title-bar row in About, Feedback, and Update windows. */
export const DIALOG_TITLE_BAR_HEIGHT = 40;

/**
 * Window chrome for Shift's small fixed windows (About, Feedback, Update).
 *
 * @remarks
 * Matches the main window: macOS draws traffic lights in the renderer, Windows
 * keeps the system's caption buttons over a Shift-coloured row, and Linux is
 * frameless with the close button drawn by the renderer.
 */
export function dialogWindowChrome(): BrowserWindowConstructorOptions {
  switch (process.platform) {
    case "darwin":
      return { titleBarStyle: "hidden", trafficLightPosition: { x: -100, y: -100 } };
    case "win32":
      return {
        titleBarStyle: "hidden",
        titleBarOverlay: {
          color: "#ffffff",
          symbolColor: "#171717",
          height: DIALOG_TITLE_BAR_HEIGHT,
        },
      };
    default:
      return { frame: false };
  }
}
