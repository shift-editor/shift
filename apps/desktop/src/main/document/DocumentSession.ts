import { dialog, type SaveDialogOptions } from "electron";
import path from "node:path";
import * as ipc from "../../shared/ipc/main";
import type { DocumentSaveRequest } from "../../shared/ipc/contract";
import type { WorkspaceDocumentState } from "../../shared/workspace/protocol";
import type { Window } from "../windows/Window";
import type { WorkspaceProcess } from "../workspace/WorkspaceProcess";

export type DocumentSessionOptions = {
  workspace: WorkspaceProcess;
  activeWindow: () => Window | null;
  applicationName: () => string;
  saveDialog?: DocumentSaveDialog;
  sendSave?: DocumentSaveSender;
};

export type DocumentSaveDialog = (
  window: Window | null,
  state: WorkspaceDocumentState,
) => Promise<string | null>;

export type DocumentSaveSender = (window: Window, request: DocumentSaveRequest) => void;

/**
 * Main-process owner of the native document save workflow.
 *
 * @remarks
 * Main owns the shell chrome: the menu/accelerator, the Save vs Save As
 * decision (read from the utility's `document.state`), and the native Save As
 * dialog. The *write* belongs to the renderer's committed-op lane — main
 * resolves the path, then asks the renderer to issue the save (one-way), so the
 * utility serializes it behind pending edits with no cross-lane watermark. Main
 * never waits on the renderer; it reflects the result when the utility emits
 * `document.changed`.
 */
export class DocumentSession {
  readonly #workspace: WorkspaceProcess;
  readonly #activeWindow: () => Window | null;
  readonly #applicationName: () => string;
  readonly #saveDialog: DocumentSaveDialog;
  readonly #sendSave: DocumentSaveSender;

  #state: WorkspaceDocumentState | null = null;

  constructor(options: DocumentSessionOptions) {
    this.#workspace = options.workspace;
    this.#activeWindow = options.activeWindow;
    this.#applicationName = options.applicationName;
    this.#saveDialog = options.saveDialog ?? defaultSaveDialog;
    this.#sendSave = options.sendSave ?? defaultSendSave;
  }

  /**
   * Runs Save, escalating to Save As when the document has no target yet.
   *
   * @throws {Error} when reading utility state fails.
   */
  async save(): Promise<void> {
    const state = await this.#workspace.documentState();
    this.acceptState(state);
    if (!state) return;

    if (state.needsSaveAs) {
      await this.#saveToNewPath(state);
      return;
    }

    this.#requestSave({ path: null });
  }

  /**
   * Runs Save As from main with a native save dialog.
   *
   * @throws {Error} when reading utility state fails.
   */
  async saveAs(): Promise<void> {
    const state = await this.#workspace.documentState();
    this.acceptState(state);
    if (!state) return;

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

  async #saveToNewPath(state: WorkspaceDocumentState): Promise<void> {
    const savePath = await this.#showSaveDialog(state);
    if (!savePath) return;

    this.#requestSave({ path: savePath });
  }

  /** Asks the active renderer to issue the save on its committed-op lane. */
  #requestSave(request: DocumentSaveRequest): void {
    const window = this.#activeWindow();
    if (!window || window.window.webContents.isDestroyed()) return;

    this.#sendSave(window, request);
  }

  async #showSaveDialog(state: WorkspaceDocumentState): Promise<string | null> {
    return this.#saveDialog(this.#activeWindow(), state);
  }

  #updateWindowTitle(): void {
    const window = this.#activeWindow();
    if (!window) return;

    const state = this.#state;
    if (!state) {
      window.setTitle(this.#applicationName());
      return;
    }

    const name = state.saveTarget ? path.basename(state.saveTarget) : "Untitled";
    const dirty = state.dirty ? " *" : "";
    window.setTitle(`${name}${dirty} - ${this.#applicationName()}`);
  }
}

async function defaultSaveDialog(
  window: Window | null,
  state: WorkspaceDocumentState,
): Promise<string | null> {
  const options: SaveDialogOptions = {
    title: "Save Shift Document",
    defaultPath: state.saveTarget ?? undefined,
    filters: [{ name: "Shift Source Package", extensions: ["shift"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  };

  const result = window
    ? await dialog.showSaveDialog(window.window, options)
    : await dialog.showSaveDialog(options);

  return result.canceled ? null : (result.filePath ?? null);
}

function defaultSendSave(window: Window, request: DocumentSaveRequest): void {
  ipc.send(window.window.webContents, "document.save", request);
}
