import {
  dialog,
  type MessageBoxOptions,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from "electron";
import path from "node:path";
import { errorToMessage } from "../../shared/errors";
import type { NativeDialogs } from "./NativeDialogs";

const OPEN_FONT_EXTENSIONS = [
  "shift",
  "ttf",
  "otf",
  "glyphs",
  "glyphspackage",
  "ufo",
  "designspace",
];

/** Uses Electron's native dialogs for production file and document choices. */
export const electronNativeDialogs: NativeDialogs = {
  async openFont(window) {
    const options: OpenDialogOptions = {
      title: "Open Font",
      filters: [
        { name: "Supported Fonts", extensions: OPEN_FONT_EXTENSIONS },
        { name: "Shift Document", extensions: ["shift"] },
        { name: "TrueType/OpenType", extensions: ["ttf", "otf"] },
        { name: "Glyphs", extensions: ["glyphs", "glyphspackage"] },
        { name: "UFO/Designspace", extensions: ["ufo", "designspace"] },
      ],
      properties: ["openFile", "openDirectory"],
    };
    const result = window
      ? await dialog.showOpenDialog(window.window, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length !== 1) return null;

    return result.filePaths[0];
  },

  async saveShiftDocument(window, suggestedPath) {
    const options: SaveDialogOptions = {
      title: "Save Shift Document",
      defaultPath: suggestedPath ?? undefined,
      filters: [{ name: "Shift Document", extensions: ["shift"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    };
    const result = window
      ? await dialog.showSaveDialog(window.window, options)
      : await dialog.showSaveDialog(options);

    return result.canceled ? null : (result.filePath ?? null);
  },

  async exportTrueTypeFont(window, state) {
    const defaultPath = state.saveTarget
      ? path.join(path.dirname(state.saveTarget), `${path.parse(state.saveTarget).name}.ttf`)
      : "Untitled.ttf";
    const options: SaveDialogOptions = {
      title: "Export TrueType Font",
      defaultPath,
      filters: [{ name: "TrueType Font", extensions: ["ttf"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    };
    const result = window
      ? await dialog.showSaveDialog(window.window, options)
      : await dialog.showSaveDialog(options);

    return result.canceled ? null : (result.filePath ?? null);
  },

  async confirmDirtyDocument(window, state, _reason, applicationName) {
    const name = state.saveTarget ? path.basename(state.saveTarget) : "Untitled";
    const options: MessageBoxOptions = {
      type: "warning",
      buttons: ["Save", "Don't Save", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: applicationName,
      message: `Save changes to ${name} before closing?`,
      detail: "Your changes will be lost if you don't save them.",
    };
    const result = window
      ? await dialog.showMessageBox(window.window, options)
      : await dialog.showMessageBox(options);

    switch (result.response) {
      case 0:
        return "save";
      case 1:
        return "discard";
      default:
        return "cancel";
    }
  },

  async showSaveFailure(window, applicationName, error) {
    const options: MessageBoxOptions = {
      type: "error",
      buttons: ["OK"],
      defaultId: 0,
      title: applicationName,
      message: "The document could not be saved.",
      detail: errorToMessage(error),
    };

    if (window) {
      await dialog.showMessageBox(window.window, options);
      return;
    }

    await dialog.showMessageBox(options);
  },

  async showExportFailure(window, applicationName, error) {
    const options: MessageBoxOptions = {
      type: "error",
      buttons: ["OK"],
      defaultId: 0,
      title: applicationName,
      message: "The TrueType font could not be exported.",
      detail: errorToMessage(error),
    };

    if (window) {
      await dialog.showMessageBox(window.window, options);
      return;
    }

    await dialog.showMessageBox(options);
  },
};
