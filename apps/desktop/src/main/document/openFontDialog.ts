import { dialog, type OpenDialogOptions } from "electron";
import type { Window } from "../windows/Window";

const OPEN_FONT_EXTENSIONS = [
  "shift",
  "ttf",
  "otf",
  "glyphs",
  "glyphspackage",
  "ufo",
  "designspace",
];

/**
 * Shows the native Open dialog for font sources.
 *
 * @param window - Native window that owns the dialog, or null for an app-modal dialog.
 * @returns null when the user cancels or no single path is selected.
 */
export async function showOpenFontDialog(window: Window | null): Promise<string | null> {
  const options: OpenDialogOptions = {
    title: "Open Font",
    filters: [
      { name: "Supported Fonts", extensions: OPEN_FONT_EXTENSIONS },
      { name: "Shift Source Package", extensions: ["shift"] },
      { name: "TrueType/OpenType", extensions: ["ttf", "otf"] },
      { name: "Glyphs", extensions: ["glyphs", "glyphspackage"] },
      { name: "UFO/Designspace", extensions: ["ufo", "designspace"] },
    ],
    properties: process.platform === "darwin" ? ["openFile", "openDirectory"] : ["openFile"],
  };

  const result = window
    ? await dialog.showOpenDialog(window.window, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled) return null;
  if (result.filePaths.length !== 1) return null;

  return result.filePaths[0];
}
