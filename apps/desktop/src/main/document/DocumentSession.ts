import { dialog, type SaveDialogOptions } from "electron";
import path from "node:path";
import * as ipc from "../../shared/ipc/main";
import type { DocumentFlushCompletion, DocumentFlushRequest } from "../../shared/ipc/contract";
import type { WorkspaceDocumentState } from "../../shared/workspace/protocol";
import type { Window } from "../windows/Window";
import type { WorkspaceProcess } from "../workspace/WorkspaceProcess";

const DEFAULT_FLUSH_TIMEOUT_MS = 5_000;

export type DocumentSessionOptions = {
  workspace: WorkspaceProcess;
  activeWindow: () => Window | null;
  applicationName: () => string;
  saveDialog?: DocumentSaveDialog;
  sendFlushRequest?: DocumentFlushRequestSender;
  flushTimeoutMs?: number;
};

export type DocumentSaveDialog = (
  window: Window | null,
  state: WorkspaceDocumentState,
) => Promise<string | null>;

export type DocumentFlushRequestSender = (window: Window, request: DocumentFlushRequest) => void;

type PendingFlush = {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

/**
 * Main-process owner of native document lifecycle workflow.
 *
 * @remarks
 * The session coordinates renderer quiescence, utility save ordering, native
 * dialogs, and window title state. It never forwards generic commands to the
 * renderer; the renderer can only answer the narrow flush request.
 */
export class DocumentSession {
  readonly #workspace: WorkspaceProcess;
  readonly #activeWindow: () => Window | null;
  readonly #applicationName: () => string;
  readonly #saveDialog: DocumentSaveDialog;
  readonly #sendFlushRequest: DocumentFlushRequestSender;
  readonly #flushTimeoutMs: number;
  readonly #pendingFlushes = new Map<string, PendingFlush>();

  #nextFlushId = 0;
  #state: WorkspaceDocumentState | null = null;

  constructor(options: DocumentSessionOptions) {
    this.#workspace = options.workspace;
    this.#activeWindow = options.activeWindow;
    this.#applicationName = options.applicationName;
    this.#saveDialog = options.saveDialog ?? defaultSaveDialog;
    this.#sendFlushRequest = options.sendFlushRequest ?? defaultSendFlushRequest;
    this.#flushTimeoutMs = options.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS;
  }

  /**
   * Runs Save from main, escalating to Save As when the utility has no target.
   *
   * @throws {Error} when renderer flushing, utility state, or filesystem save fails.
   */
  async save(): Promise<void> {
    await this.#flushRenderer();

    const state = await this.#workspace.documentState();
    this.acceptState(state);
    if (!state) return;

    if (state.needsSaveAs) {
      await this.#saveAsAfterFlush(state);
      return;
    }

    try {
      this.acceptState(await this.#workspace.saveDocument());
    } catch (error) {
      if (isNeedsSaveAs(error)) {
        await this.#saveAsAfterFlush(state);
        return;
      }

      throw error;
    }
  }

  /**
   * Runs Save As from main with a native save dialog.
   *
   * @throws {Error} when renderer flushing, utility state, or filesystem save fails.
   */
  async saveAs(): Promise<void> {
    await this.#flushRenderer();

    const state = await this.#workspace.documentState();
    this.acceptState(state);
    if (!state) return;

    await this.#saveAsAfterFlush(state);
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

  /**
   * Resolves a pending renderer flush request.
   *
   * @param completion - request id plus an optional renderer failure message.
   */
  completeFlush(completion: DocumentFlushCompletion): void {
    const pending = this.#pendingFlushes.get(completion.requestId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.#pendingFlushes.delete(completion.requestId);

    if (completion.error) {
      pending.reject(new Error(completion.error));
      return;
    }

    pending.resolve();
  }

  async #saveAsAfterFlush(state: WorkspaceDocumentState): Promise<void> {
    const savePath = await this.#showSaveDialog(state);
    if (!savePath) return;

    this.acceptState(await this.#workspace.saveDocumentAs(savePath));
  }

  async #flushRenderer(): Promise<void> {
    const window = this.#activeWindow();
    if (!window || window.window.webContents.isDestroyed()) return;

    this.#nextFlushId += 1;
    const requestId = String(this.#nextFlushId);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingFlushes.delete(requestId);
        reject(new Error("renderer did not settle document edits before save"));
      }, this.#flushTimeoutMs);

      this.#pendingFlushes.set(requestId, { resolve, reject, timeout });
      this.#sendFlushRequest(window, { requestId });
    });
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

function isNeedsSaveAs(error: unknown): boolean {
  return error instanceof Error && error.message.includes("workspace needs a save path");
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

function defaultSendFlushRequest(window: Window, request: DocumentFlushRequest): void {
  ipc.send(window.window.webContents, "document.flushRequested", request);
}
