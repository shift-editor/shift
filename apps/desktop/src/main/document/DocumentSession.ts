import { dialog, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import path from "node:path";
import * as ipc from "../../shared/ipc/main";
import type { DocumentOpenRequest, DocumentSaveRequest } from "../../shared/ipc/contract";
import type { WorkspaceDocumentState } from "../../shared/workspace/protocol";
import type { Window } from "../windows/Window";
import type { WorkspaceProcess } from "../workspace/WorkspaceProcess";

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
  workspace: WorkspaceProcess;
  activeWindow: () => Window | null;
  applicationName: () => string;
};

/**
 * Main-process owner of the native document workflow.
 *
 * @remarks
 * Main owns the shell chrome, native dialogs, and the Save vs Save As decision
 * read from the utility's `document.state`. Document reads and writes belong to
 * the renderer's committed-op lane; main resolves dialog paths, then asks the
 * renderer to issue the open/save request one-way.
 */
export class DocumentSession {
  readonly #workspace: WorkspaceProcess;
  readonly #activeWindow: () => Window | null;
  readonly #applicationName: () => string;

  #state: WorkspaceDocumentState | null = null;

  constructor(options: DocumentSessionOptions) {
    this.#workspace = options.workspace;
    this.#activeWindow = options.activeWindow;
    this.#applicationName = options.applicationName;
  }

  /** Runs Open from main with a native open dialog. */
  async open(): Promise<void> {
    const openPath = await this.#showOpenDialog();
    if (!openPath) return;

    this.#requestOpen({ path: openPath });
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

    ipc.send(window.window.webContents, "document.save", request);
  }

  /** Asks the active renderer to open the selected document. */
  #requestOpen(request: DocumentOpenRequest): void {
    const window = this.#activeWindow();
    if (!window || window.window.webContents.isDestroyed()) return;

    ipc.send(window.window.webContents, "document.open", request);
  }

  async #showSaveDialog(state: WorkspaceDocumentState): Promise<string | null> {
    const options: SaveDialogOptions = {
      title: "Save Shift Document",
      defaultPath: state.saveTarget ?? undefined,
      filters: [{ name: "Shift Source Package", extensions: ["shift"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    };

    const window = this.#activeWindow();
    const result = window
      ? await dialog.showSaveDialog(window.window, options)
      : await dialog.showSaveDialog(options);

    return result.canceled ? null : (result.filePath ?? null);
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

    const window = this.#activeWindow();
    const result = window
      ? await dialog.showOpenDialog(window.window, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled) return null;
    if (result.filePaths.length !== 1) return null;

    return result.filePaths[0];
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
