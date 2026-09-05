import {
  dialog,
  type MessageBoxOptions,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from "electron";
import path from "node:path";
import { message } from "../../shared/messages";
import { OPEN_FONT_EXTENSIONS } from "../../shared/openFontExtensions";
import type { Window } from "../windows/Window";
import type { NativeDialogs } from "./NativeDialogs";

async function showFailure(
  window: Window | null,
  applicationName: string,
  messageText: string,
  detail: string,
): Promise<void> {
  const options: MessageBoxOptions = {
    type: "error",
    buttons: [message("action.ok")],
    defaultId: 0,
    title: applicationName,
    message: messageText,
    detail,
  };

  if (window) {
    await dialog.showMessageBox(window.window, options);
    return;
  }

  await dialog.showMessageBox(options);
}

/** Uses Electron's native dialogs for production file and document choices. */
export const electronNativeDialogs: NativeDialogs = {
  async openFont(window) {
    const options: OpenDialogOptions = {
      title: message("file.open.title"),
      filters: [
        { name: message("file.open.filter.supported"), extensions: OPEN_FONT_EXTENSIONS },
        { name: message("file.open.filter.shift"), extensions: ["shift"] },
        { name: message("file.open.filter.outline"), extensions: ["ttf", "otf"] },
        { name: message("file.open.filter.glyphs"), extensions: ["glyphs", "glyphspackage"] },
        { name: message("file.open.filter.sources"), extensions: ["ufo", "designspace"] },
      ],
      properties: ["openFile", "openDirectory"],
    };
    const result = window
      ? await dialog.showOpenDialog(window.window, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length !== 1) return null;

    return result.filePaths[0];
  },

  async showCreateFailure(window, applicationName) {
    await showFailure(
      window,
      applicationName,
      message("document.createFailed.message"),
      message("document.createFailed.detail", { applicationName }),
    );
  },

  async showOpenFailure(window, applicationName) {
    await showFailure(
      window,
      applicationName,
      message("document.openFailed.message"),
      message("document.openFailed.detail"),
    );
  },

  async saveShiftDocument(window, suggestedPath) {
    const options: SaveDialogOptions = {
      title: message("file.saveShift.title"),
      defaultPath: suggestedPath ?? undefined,
      filters: [{ name: message("file.saveShift.filter"), extensions: ["shift"] }],
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
      : message("file.exportTrueType.untitledFilename");
    const options: SaveDialogOptions = {
      title: message("file.exportTrueType.title"),
      defaultPath,
      filters: [{ name: message("file.exportTrueType.filter"), extensions: ["ttf"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    };
    const result = window
      ? await dialog.showSaveDialog(window.window, options)
      : await dialog.showSaveDialog(options);

    return result.canceled ? null : (result.filePath ?? null);
  },

  async confirmDirtyDocument(window, state, _reason, applicationName) {
    const name = state.saveTarget
      ? path.basename(state.saveTarget)
      : message("document.untitledName");
    const options: MessageBoxOptions = {
      type: "warning",
      buttons: [message("action.save"), message("action.dontSave"), message("action.cancel")],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: applicationName,
      message: message("document.unsaved.message", { documentName: name }),
      detail: message("document.unsaved.detail"),
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

  async confirmDocumentReopen(window, applicationName, failure) {
    const options: MessageBoxOptions = {
      type: failure === "crashed" ? "warning" : "error",
      buttons:
        failure === "crashed"
          ? [message("action.reopenDocument"), message("action.closeWindow")]
          : [message("action.tryAgain"), message("action.closeWindow")],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: applicationName,
      message:
        failure === "crashed"
          ? message("document.crashed.message")
          : message("document.reopenFailed.message"),
      detail:
        failure === "crashed"
          ? message("document.crashed.detail")
          : message("document.reopenFailed.detail"),
    };
    const result = window
      ? await dialog.showMessageBox(window.window, options)
      : await dialog.showMessageBox(options);

    return result.response === 0 ? "reopen" : "close";
  },

  async showSaveFailure(window, applicationName) {
    await showFailure(
      window,
      applicationName,
      message("document.saveFailed.message"),
      message("document.saveFailed.detail"),
    );
  },

  async showExportFailure(window, applicationName) {
    await showFailure(
      window,
      applicationName,
      message("document.exportFailed.message"),
      message("document.exportFailed.detail"),
    );
  },
};
