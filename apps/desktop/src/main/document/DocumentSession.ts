import path from "node:path";
import type { WorkspaceDocumentState } from "../../shared/workspace/protocol";
import type { NativeDialogs } from "../dialogs/NativeDialogs";
import type { Window } from "../windows/Window";
import type { Document } from "./DocumentClient";
import type { CloseReason } from "./types";
import { createShiftLogger, type ShiftLogger } from "../logging";

export type DocumentSessionOptions = {
  document: Document;
  closeDocument: (discard: boolean) => Promise<void>;
  dialogWindow: () => Window | null;
  windows: () => readonly Window[];
  applicationName: () => string;
  nativeDialogs: NativeDialogs;
  log?: ShiftLogger;
};

/**
 * Main-process owner of the native document workflow.
 *
 * @remarks
 * Main owns the shell chrome and native dialogs. Document state reads and
 * writes that affect save and close decisions go through the renderer's
 * committed-op lane so pending edits cannot be bypassed by main-process reads.
 */
export class DocumentSession {
  readonly #document: Document;
  readonly #closeDocument: (discard: boolean) => Promise<void>;
  readonly #dialogWindow: () => Window | null;
  readonly #windows: () => readonly Window[];
  readonly #applicationName: () => string;
  readonly #nativeDialogs: NativeDialogs;
  readonly #log: ShiftLogger;

  #state: WorkspaceDocumentState | null = null;

  constructor(options: DocumentSessionOptions) {
    this.#document = options.document;
    this.#closeDocument = options.closeDocument;
    this.#dialogWindow = options.dialogWindow;
    this.#windows = options.windows;
    this.#applicationName = options.applicationName;
    this.#nativeDialogs = options.nativeDialogs;
    this.#log = options.log ?? createShiftLogger("document.session");
  }

  /** Returns whether a close transition needs document confirmation. */
  shouldConfirmClose(): boolean {
    const shouldConfirm = this.#document.connected || this.#state?.dirty === true;
    this.#log.debug("close guard availability checked", {
      connected: this.#document.connected,
      cachedDirty: this.#state?.dirty ?? null,
      shouldConfirm,
    });
    return shouldConfirm;
  }

  /**
   * Confirms whether the current document may be closed.
   *
   * @param reason - Native transition that would discard the document.
   * @returns `true` when the transition may continue.
   * @throws {Error} when the renderer cannot provide a settled document state.
   */
  async confirmClose(reason: CloseReason): Promise<boolean> {
    this.#log.info("close guard started", {
      reason,
      connected: this.#document.connected,
      cachedDirty: this.#state?.dirty ?? null,
    });

    const state = await this.#closeState();
    if (!state) {
      this.#log.info("close guard allowed: no document state", { reason });
      return true;
    }

    if (!state.dirty) {
      await this.#closeDocument(false);
      this.#log.info("close guard allowed: document is clean", { reason });
      return true;
    }

    const choice = await this.#nativeDialogs.confirmDirtyDocument(
      this.#dialogWindow(),
      state,
      reason,
      this.#applicationName(),
    );
    this.#log.info("dirty document dialog completed", {
      reason,
      choice,
      saveTarget: state.saveTarget,
      needsSaveAs: state.needsSaveAs,
    });

    if (choice === "cancel") {
      this.#log.info("close guard canceled by user", { reason });
      return false;
    }

    if (choice === "discard") {
      await this.#closeDocument(true);
      this.#log.info("close guard allowed: changes discarded", { reason });
      return true;
    }

    const saved = await this.#saveDirtyDocument(state);
    if (saved) await this.#closeDocument(false);
    this.#log.info(
      saved ? "close guard allowed: document saved" : "close guard blocked: save failed",
      {
        reason,
      },
    );
    return saved;
  }

  /**
   * Runs Save, escalating to Save As when the document has no target yet.
   *
   * @throws {Error} when the renderer cannot read state or save.
   */
  async save(): Promise<void> {
    this.#log.info("save document requested");
    const state = await this.#requestState();
    this.acceptState(state);
    if (!state) {
      this.#log.info("save document skipped: no document state");
      return;
    }

    if (state.needsSaveAs) {
      await this.#saveToNewPath(state);
      return;
    }

    await this.#requestSave(null);
    this.#log.info("save document completed", { saveTarget: state.saveTarget });
  }

  /**
   * Runs Save As from main with a native save dialog.
   *
   * @throws {Error} when the renderer cannot read state or save.
   */
  async saveAs(): Promise<void> {
    this.#log.info("save as requested");
    const state = await this.#requestState();
    this.acceptState(state);
    if (!state) {
      this.#log.info("save as skipped: no document state");
      return;
    }

    await this.#saveToNewPath(state);
  }

  /**
   * Shows a native destination dialog and exports the latest committed document as TTF.
   *
   * @remarks
   * The request travels through the renderer document lane so pending edits settle before
   * the utility process captures an immutable native export snapshot. Export never changes
   * the document's save target or dirty state.
   *
   * @throws {Error} when document state cannot be read.
   */
  async exportTtf(): Promise<void> {
    this.#log.info("TTF export requested");
    const state = await this.#requestState();
    if (!state) {
      this.#log.info("TTF export skipped: no document state");
      return;
    }

    const outputPath = await this.#nativeDialogs.exportTrueTypeFont(this.#dialogWindow(), state);
    if (!outputPath) {
      this.#log.info("TTF export canceled");
      return;
    }

    try {
      await this.#document.export(outputPath);
      this.#log.info("TTF export completed", { path: outputPath });
    } catch (error) {
      this.#log.warn("TTF export failed", error);
      await this.#nativeDialogs.showExportFailure(
        this.#dialogWindow(),
        this.#applicationName(),
        error,
      );
    }
  }

  /**
   * Applies a utility-owned document state snapshot to main-owned UI.
   *
   * @param state - latest utility state, or null when no document is open.
   */
  acceptState(state: WorkspaceDocumentState | null): void {
    this.#state = state;
    this.#updateWindowTitle();
  }

  /** Reapplies cached document identity and dirty state to every attached window title. */
  refreshWindowTitles(): void {
    this.#updateWindowTitle();
  }

  async #saveToNewPath(state: WorkspaceDocumentState): Promise<WorkspaceDocumentState | null> {
    const savePath = await this.#nativeDialogs.saveShiftDocument(this.#dialogWindow(), state);
    if (!savePath) {
      this.#log.info("save as canceled", { saveTarget: state.saveTarget });
      return null;
    }

    this.#log.info("save as path selected", { path: savePath });
    return this.#requestSave(savePath);
  }

  async #saveDirtyDocument(state: WorkspaceDocumentState): Promise<boolean> {
    try {
      const saved = state.needsSaveAs
        ? await this.#saveToNewPath(state)
        : await this.#requestSave(null);
      return saved !== null;
    } catch (error) {
      this.#log.warn("dirty document save failed", error);
      await this.#nativeDialogs.showSaveFailure(
        this.#dialogWindow(),
        this.#applicationName(),
        error,
      );
      return false;
    }
  }

  async #closeState(): Promise<WorkspaceDocumentState | null> {
    try {
      return await this.#requestState();
    } catch (error) {
      if (!this.#document.connected && (!this.#state || !this.#state.dirty)) {
        this.#log.warn(
          "close guard ignored disconnected renderer with no cached dirty document",
          error,
        );
        return null;
      }

      this.#log.warn("close guard could not read document state", error);
      await this.#nativeDialogs.showSaveFailure(
        this.#dialogWindow(),
        this.#applicationName(),
        error,
      );
      return this.#state;
    }
  }

  async #requestState(): Promise<WorkspaceDocumentState | null> {
    const state = await this.#document.state();
    this.acceptState(state);
    return state;
  }

  async #requestSave(savePath: string | null): Promise<WorkspaceDocumentState> {
    this.#log.info("document save sent to renderer", { path: savePath });
    const state = await this.#document.save(savePath);
    this.acceptState(state);
    return state;
  }

  #updateWindowTitle(): void {
    const state = this.#state;
    const windows = this.#windows();
    if (windows.length === 0) return;

    if (!state) {
      for (const window of windows) window.setTitle(this.#applicationName());
      return;
    }

    const name = state.saveTarget ? path.basename(state.saveTarget) : "Untitled";
    const dirty = state.dirty ? " *" : "";
    for (const window of windows) {
      window.setTitle(`${name}${dirty} - ${this.#applicationName()}`);
    }
  }
}
