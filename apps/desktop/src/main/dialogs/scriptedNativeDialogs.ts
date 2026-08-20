import type { DirtyDocumentChoice } from "../document/types";
import type { NativeDialogs } from "./NativeDialogs";

const dirtyDocumentChoices = parseDirtyDocumentChoices(
  process.env.SHIFT_E2E_DIRTY_DOCUMENT_CHOICES,
);
const saveShiftPaths = parseSaveShiftPaths(process.env.SHIFT_E2E_SAVE_SHIFT_PATHS);
let dirtyDocumentChoiceIndex = 0;
let saveShiftPathIndex = 0;

/** Supplies deterministic outer-dialog choices to Electron E2E tests. */
export const scriptedNativeDialogs: NativeDialogs = {
  async openFont() {
    return process.env.SHIFT_E2E_OPEN_FONT_PATH || process.env.SHIFT_E2E_SAVE_SHIFT_PATH || null;
  },

  async saveShiftDocument() {
    const savePath = saveShiftPaths[saveShiftPathIndex];
    if (savePath !== undefined) {
      saveShiftPathIndex++;
      return savePath || null;
    }

    return process.env.SHIFT_E2E_SAVE_SHIFT_PATH || null;
  },

  async exportTrueTypeFont() {
    return process.env.SHIFT_E2E_EXPORT_TTF_PATH || null;
  },

  async confirmDirtyDocument() {
    await dirtyDocumentDelay();

    const choice = dirtyDocumentChoices[dirtyDocumentChoiceIndex];
    if (choice) {
      dirtyDocumentChoiceIndex++;
      return choice;
    }

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

function parseDirtyDocumentChoices(value: string | undefined): DirtyDocumentChoice[] {
  if (!value) return [];

  return value.split(",").map(dirtyDocumentChoice);
}

function parseSaveShiftPaths(value: string | undefined): string[] {
  if (!value) return [];

  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
    throw new Error("SHIFT_E2E_SAVE_SHIFT_PATHS must be a JSON string array");
  }

  return parsed;
}

async function dirtyDocumentDelay(): Promise<void> {
  const delayMs = Number(process.env.SHIFT_E2E_DIRTY_DOCUMENT_DELAY_MS ?? 0);
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
