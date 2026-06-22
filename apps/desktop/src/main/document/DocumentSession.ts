import {
  dialog,
  type MessageBoxOptions,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from "electron";
import path from "node:path";
import { errorToMessage } from "../../shared/errors";
import type { WorkspaceDocumentState } from "../../shared/workspace/protocol";
import type { Window } from "../windows/Window";
import type { Document } from "./DocumentClient";
import { createShiftLogger, type ShiftLogger } from "../logging";

const OPEN_FONT_EXTENSIONS = [
  "shift",
  "ttf",
  "otf",
  "glyphs",
  "glyphspackage",
  "ufo",
  "designspace",
];

export type DocumentSessionOptions = {
  document: Document;
  dialogWindow: () => Window | null;
  windows: () => readonly Window[];
  applicationName: () => string;
  log?: ShiftLogger;
};

export type CloseReason = "window" | "quit" | "replace-document";
type DirtyDocumentChoice = "save" | "discard" | "cancel";

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
  readonly #dialogWindow: () => Window | null;
  readonly #windows: () => readonly Window[];
  readonly #applicationName: () => string;
  readonly #log: ShiftLogger;

  #state: WorkspaceDocumentState | null = null;

  constructor(options: DocumentSessionOptions) {
    this.#document = options.document;
    this.#dialogWindow = options.dialogWindow;
    this.#windows = options.windows;
    this.#applicationName = options.applicationName;
    this.#log = options.log ?? createShiftLogger("document.session");
  }

  /** Creates an untitled workspace through the renderer edit lane. */
  async create(): Promise<void> {
    this.#log.info("new document requested");
    if (!(await this.confirmClose("replace-document"))) {
      this.#log.info("new document canceled by close guard");
      return;
    }

    await this.#document.create();
    this.#log.info("new document created");
  }

  /** Runs Open from main with a native open dialog. */
  async open(): Promise<void> {
    this.#log.info("open document requested");
    const openPath = await this.#showOpenDialog();
    if (!openPath) {
      this.#log.info("open document canceled before file selection");
      return;
    }

    if (!(await this.confirmClose("replace-document"))) {
      this.#log.info("open document canceled by close guard", { path: openPath });
      return;
    }

    try {
      await this.#requestOpen(openPath);
    } catch (error) {
      this.#log.warn("open document failed", { path: openPath }, error);
      await this.#showOpenFailedDialog(openPath, error);
      return;
    }

    this.#log.info("open document completed", { path: openPath });
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
      this.#log.info("close guard allowed: document is clean", { reason });
      return true;
    }

    const choice = await this.#showDirtyDocumentDialog(state, reason);
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
      this.#log.info("close guard allowed: changes discarded", { reason });
      return true;
    }

    const saved = await this.#saveDirtyDocument(state);
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
   * Applies a utility-owned document state snapshot to main-owned UI.
   *
   * @param state - latest utility state, or null when no document is open.
   */
  acceptState(state: WorkspaceDocumentState | null): void {
    this.#state = state;
    this.#updateWindowTitle();
  }

  async #saveToNewPath(state: WorkspaceDocumentState): Promise<WorkspaceDocumentState | null> {
    const savePath = await this.#showSaveDialog(state);
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
      await this.#showSaveFailedDialog(error);
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
      await this.#showSaveFailedDialog(error);
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

  async #requestOpen(openPath: string): Promise<void> {
    this.#log.info("document open sent to renderer", { path: openPath });
    await this.#document.open(openPath);
  }

  async #showSaveDialog(state: WorkspaceDocumentState): Promise<string | null> {
    const options: SaveDialogOptions = {
      title: "Save Shift Document",
      defaultPath: state.saveTarget ?? undefined,
      filters: [{ name: "Shift Source Package", extensions: ["shift"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    };

    const window = this.#dialogWindow();
    const result = window
      ? await dialog.showSaveDialog(window.window, options)
      : await dialog.showSaveDialog(options);

    return result.canceled ? null : (result.filePath ?? null);
  }

  async #showDirtyDocumentDialog(
    state: WorkspaceDocumentState,
    reason: CloseReason,
  ): Promise<DirtyDocumentChoice> {
    const name = state.saveTarget ? path.basename(state.saveTarget) : "Untitled";
    const options: MessageBoxOptions = {
      type: "warning",
      buttons: ["Save", "Don't Save", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: this.#applicationName(),
      message: this.#dirtyDocumentMessage(reason, name),
      detail: "Your changes will be lost if you don't save them.",
    };

    const window = this.#dialogWindow();
    const result = window
      ? await dialog.showMessageBox(window.window, options)
      : await dialog.showMessageBox(options);

    if (result.response === 0) return "save";
    if (result.response === 1) return "discard";
    return "cancel";
  }

  async #showSaveFailedDialog(error: unknown): Promise<void> {
    const options: MessageBoxOptions = {
      type: "error",
      buttons: ["OK"],
      defaultId: 0,
      title: this.#applicationName(),
      message: "The document could not be saved.",
      detail: errorToMessage(error),
    };

    const window = this.#dialogWindow();
    if (window) {
      await dialog.showMessageBox(window.window, options);
      return;
    }

    await dialog.showMessageBox(options);
  }

  async #showOpenFailedDialog(openPath: string, error: unknown): Promise<void> {
    const options: MessageBoxOptions = {
      type: "error",
      buttons: ["OK"],
      defaultId: 0,
      title: this.#applicationName(),
      message: "The font could not be loaded.",
      detail: `${openPath}\n\n${errorToMessage(error)}`,
    };

    const window = this.#dialogWindow();
    if (window) {
      await dialog.showMessageBox(window.window, options);
      return;
    }

    await dialog.showMessageBox(options);
  }

  #dirtyDocumentMessage(reason: CloseReason, name: string): string {
    if (reason === "replace-document") {
      return `Save changes to ${name} before replacing it?`;
    }

    return `Save changes to ${name} before closing?`;
  }

  async #showOpenDialog(): Promise<string | null> {
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

    const window = this.#dialogWindow();
    const result = window
      ? await dialog.showOpenDialog(window.window, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled) return null;
    if (result.filePaths.length !== 1) return null;

    return result.filePaths[0];
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
