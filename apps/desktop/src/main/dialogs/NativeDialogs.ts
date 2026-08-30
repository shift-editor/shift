import type { WorkspaceDocumentState } from "../../shared/workspace/protocol";
import type { CloseReason, DirtyDocumentChoice, DocumentCrashChoice } from "../document/types";
import type { Window } from "../windows/Window";

/** Owns native user choices at the outer Electron dialog boundary. */
export interface NativeDialogs {
  /**
   * Selects one supported font path.
   *
   * @param window - native window that should own the choice.
   * @returns the selected path, or null when the user cancels.
   */
  openFont(window: Window | null): Promise<string | null>;

  /**
   * Shows a blocking failure after a new document could not be created.
   *
   * @param window - native window that should own the message.
   * @param applicationName - product name shown by the native shell.
   * @param error - failure whose safe diagnostic detail is presented.
   */
  showCreateFailure(window: Window | null, applicationName: string, error: unknown): Promise<void>;

  /**
   * Shows a blocking failure after a selected font could not be opened.
   *
   * @param window - native window that should own the message.
   * @param applicationName - product name shown by the native shell.
   * @param error - failure whose safe diagnostic detail is presented.
   */
  showOpenFailure(window: Window | null, applicationName: string, error: unknown): Promise<void>;

  /**
   * Selects an independent `.shift` destination.
   *
   * @param window - native window that should own the choice.
   * @param suggestedPath - current document target or source-derived `.shift` suggestion.
   * @returns the selected path, or null when the user cancels.
   */
  saveShiftDocument(window: Window | null, suggestedPath: string | null): Promise<string | null>;

  /**
   * Selects a TrueType export destination.
   *
   * @param window - native window that should own the choice.
   * @param state - settled document state used to suggest an output path.
   * @returns the selected path, or null when the user cancels.
   */
  exportTrueTypeFont(window: Window | null, state: WorkspaceDocumentState): Promise<string | null>;

  /**
   * Returns the explicit action chosen for a dirty close transition.
   *
   * @param window - native window that should own the confirmation.
   * @param state - settled dirty document being closed.
   * @param reason - native transition that requested confirmation.
   * @param applicationName - product name shown by the native shell.
   * @returns the user's Save, Discard, or Cancel choice.
   */
  confirmDirtyDocument(
    window: Window | null,
    state: WorkspaceDocumentState,
    reason: CloseReason,
    applicationName: string,
  ): Promise<DirtyDocumentChoice>;

  /**
   * Confirms whether a crashed document should be reconstructed.
   *
   * @param window - native window that should own the confirmation.
   * @param applicationName - product name shown by the native shell.
   * @param failure - whether this is the first crash prompt or a failed reopen retry prompt.
   * @returns the user's Reopen/Try Again or Close Window choice.
   */
  confirmDocumentReopen(
    window: Window | null,
    applicationName: string,
    failure: "crashed" | "restoreFailed",
  ): Promise<DocumentCrashChoice>;

  /**
   * Shows a blocking failure after a document save was refused or failed.
   *
   * @param window - native window that should own the message.
   * @param applicationName - product name shown by the native shell.
   * @param error - failure whose safe diagnostic detail is presented.
   */
  showSaveFailure(window: Window | null, applicationName: string, error: unknown): Promise<void>;

  /**
   * Shows a blocking failure after TrueType export was refused or failed.
   *
   * @param window - native window that should own the message.
   * @param applicationName - product name shown by the native shell.
   * @param error - failure whose safe diagnostic detail is presented.
   */
  showExportFailure(window: Window | null, applicationName: string, error: unknown): Promise<void>;
}
