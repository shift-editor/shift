import type { DirtyDocumentChoice } from "../document/types";
import type { NativeDialogs } from "./NativeDialogs";

/** Supplies deterministic outer-dialog choices to Electron E2E tests. */
export const scriptedNativeDialogs: NativeDialogs = {
  async openFont() {
    return process.env.SHIFT_E2E_OPEN_FONT_PATH || process.env.SHIFT_E2E_SAVE_SHIFT_PATH || null;
  },

  async saveShiftDocument() {
    return process.env.SHIFT_E2E_SAVE_SHIFT_PATH || null;
  },

  async exportTrueTypeFont() {
    return process.env.SHIFT_E2E_EXPORT_TTF_PATH || null;
  },

  async confirmDirtyDocument() {
    return dirtyDocumentChoice(process.env.SHIFT_E2E_DIRTY_DOCUMENT_CHOICE);
  },

  async showSaveFailure() {},

  async showExportFailure() {},
};

function dirtyDocumentChoice(value: string | undefined): DirtyDocumentChoice {
  switch (value) {
    case "save":
    case "discard":
      return value;
    default:
      return "cancel";
  }
}
