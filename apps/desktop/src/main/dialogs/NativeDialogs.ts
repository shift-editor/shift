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
   * Shows a blocking, nontechnical failure after document creation fails.
   *
   * @param window - native window that should own the message.
   * @param applicationName - product name shown by the native shell.
   */
  showCreateFailure(window: Window | null, applicationName: string): Promise<void>;

  /**
   * Shows a blocking, nontechnical failure after opening a selected font fails.
   *
   * @param window - native window that should own the message.
   * @param applicationName - product name shown by the native shell.
   */
  showOpenFailure(window: Window | null, applicationName: string): Promise<void>;

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
   * Shows a blocking, nontechnical failure after a document save fails.
   *
   * @param window - native window that should own the message.
   * @param applicationName - product name shown by the native shell.
   */
  showSaveFailure(window: Window | null, applicationName: string): Promise<void>;

  /**
   * Shows a blocking, nontechnical failure after TrueType export fails.
   *
   * @param window - native window that should own the message.
   * @param applicationName - product name shown by the native shell.
   */
  showExportFailure(window: Window | null, applicationName: string): Promise<void>;
}
