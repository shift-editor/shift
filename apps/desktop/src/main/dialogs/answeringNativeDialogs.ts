import type { DirtyDocumentChoice } from "../document/types";
import type { NativeDialogs } from "./NativeDialogs";

/**
 * Native dialogs for tests: every picker is cancelled, every failure notice is
 * dismissed, and a dirty document gets the answer the test supplies.
 *
 * @param confirmDirtyDocument - answers the save, discard or cancel prompt;
 * defaults to cancelling.
 */
export function answeringNativeDialogs(
  confirmDirtyDocument: NativeDialogs["confirmDirtyDocument"] = async () =>
    "cancel" satisfies DirtyDocumentChoice,
): NativeDialogs {
  return {
    async openFont() {
      return null;
    },
    async openFontFolder() {
      return null;
    },
    async showCreateFailure() {},
    async showOpenFailure() {},
    async saveShiftDocument() {
      return null;
    },
    async exportTrueTypeFont() {
      return null;
    },
    confirmDirtyDocument,
    async confirmDocumentReopen() {
      return "close";
    },
    async showSaveFailure() {},
    async showExportFailure() {},
  };
}
