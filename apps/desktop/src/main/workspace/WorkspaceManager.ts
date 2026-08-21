import { BrowserWindow, type WebContents } from "electron";
import path from "node:path";
import { DocumentClient } from "../document/DocumentClient";
import type { NativeDialogs } from "../dialogs/NativeDialogs";
import type { Window } from "../windows/Window";
import type {
  WorkspaceDocumentIdentity,
  WorkspaceDocumentState,
} from "../../shared/workspace/protocol";
import { WorkspaceProcess } from "./WorkspaceProcess";
import { FontSessionHost, type FontSessionId } from "./FontSessionHost";
import { DocumentSessionIndex } from "./DocumentSessionIndex";
import { isConvertiblePreviewPath } from "../../shared/workspace/previewConversion";

/** Provides app-owned values required when a workspace session is created. */
export interface WorkspaceManagerOptions {
  readonly documentsRoot: () => string;
  readonly applicationName: () => string;
  readonly nativeDialogs: NativeDialogs;
}

/**
 * Tracks live font workspace sessions by workspace identity.
 *
 * @remarks
 * Commands and IPC handlers resolve a workspace from the focused or sending
 * window before acting on document state. The manager also creates sessions
 * so each loaded font gets its own process and renderer-mediated document
 * lane.
 */
export class WorkspaceManager {
  readonly #documentsRoot: () => string;
  readonly #applicationName: () => string;
  readonly #nativeDialogs: NativeDialogs;
  readonly #sessionsById = new Map<FontSessionId, FontSessionHost>();
  readonly #sessionIdByWindowId = new Map<number, FontSessionId>();
  readonly #documentSessions = new DocumentSessionIndex();
  readonly #documentOpenById = new Map<string, Promise<FontSessionHost>>();

  /**
   * Creates a manager for live font workspace sessions.
   *
   * @param options - Callbacks that provide app-level values when a session is created.
   */
  constructor(options: WorkspaceManagerOptions) {
    this.#documentsRoot = options.documentsRoot;
    this.#applicationName = options.applicationName;
    this.#nativeDialogs = options.nativeDialogs;
  }

  /**
   * Creates an untitled workspace session.
   *
   * @returns the live session that owns the new workspace.
   */
  async createUntitled(): Promise<FontSessionHost> {
    return this.#createSession((workspaceProcess) => workspaceProcess.createWorkspace());
  }

  /** Fully imports a convertible preview and publishes a new canonical document. */
  async createDocumentFromPreview(
    sourcePath: string,
    documentPath: string,
  ): Promise<FontSessionHost> {
    if (!isConvertiblePreviewPath(sourcePath)) {
      throw new Error(`Preview source cannot become a Shift document: ${sourcePath}`);
    }

    return this.#createSession((workspaceProcess) =>
      workspaceProcess.createDocumentFromSource(sourcePath, documentPath),
    );
  }

  /**
   * Opens a font source path in a workspace session.
   *
   * @param sourcePath - User-selected font source path.
   * @returns a live session; native documents are reused by `DocumentId`.
   */
  async openPath(sourcePath: string): Promise<FontSessionHost> {
    if (!isShiftDocumentPath(sourcePath)) return this.#openFontSource(sourcePath);

    const workspaceProcess = new WorkspaceProcess();
    workspaceProcess.start(this.#documentsRoot());

    try {
      await workspaceProcess.whenReady();

      const identity = await workspaceProcess.inspectDocument(sourcePath);
      const existingBeforeOpen = this.#sessionForDocument(identity);
      if (existingBeforeOpen) {
        workspaceProcess.stop();
        return existingBeforeOpen;
      }

      const existingOpen = this.#documentOpenById.get(identity.documentId);
      if (existingOpen) {
        workspaceProcess.stop();
        return existingOpen;
      }

      const opening = this.#openDocument(sourcePath, workspaceProcess);
      this.#documentOpenById.set(identity.documentId, opening);
      try {
        return await opening;
      } finally {
        if (this.#documentOpenById.get(identity.documentId) === opening) {
          this.#documentOpenById.delete(identity.documentId);
        }
      }
    } catch (error) {
      workspaceProcess.stop();
      throw error;
    }
  }

  /**
   * Returns the live workspace session for an id.
   *
   * @param workspaceId - Stable identity minted for a loaded workspace session.
   * @returns null when no live session is registered for the id.
   */
  get(workspaceId: FontSessionId): FontSessionHost | null {
    return this.#sessionsById.get(workspaceId) ?? null;
  }

  /**
   * Registers one live workspace session.
   *
   * @param session - Workspace session that is not already registered.
   * @throws {Error} when another session already uses the same workspace id.
   */
  register(session: FontSessionHost): void {
    if (this.#sessionsById.has(session.workspaceId)) {
      throw new Error(`Workspace session already registered: ${session.workspaceId}`);
    }

    if (session.mode === "authored") this.#documentSessions.track(session);
    this.#sessionsById.set(session.workspaceId, session);
  }

  /**
   * Removes a workspace session and all of its window associations.
   *
   * @param workspaceId - Stable identity for the session to remove.
   */
  unregister(workspaceId: FontSessionId): void {
    const session = this.#sessionsById.get(workspaceId);
    if (!session) return;

    for (const window of session.windows) {
      this.#sessionIdByWindowId.delete(window.window.id);
    }
    this.#documentSessions.untrack(workspaceId);
    this.#sessionsById.delete(workspaceId);
    session.dispose();
  }

  /**
   * Attaches a native window to a registered workspace session.
   *
   * @param workspaceId - Session that should own the window.
   * @param window - Native window wrapper to associate with the session.
   * @throws {Error} when the session is missing or the window belongs to another session.
   */
  attachWindow(workspaceId: FontSessionId, window: Window): void {
    const session = this.#requireWorkspace(workspaceId);
    const currentWorkspaceId = this.#sessionIdByWindowId.get(window.window.id);

    if (currentWorkspaceId && currentWorkspaceId !== workspaceId) {
      throw new Error(`Window is already attached to workspace: ${currentWorkspaceId}`);
    }

    session.attachWindow(window);
    this.#sessionIdByWindowId.set(window.window.id, workspaceId);
  }

  /**
   * Detaches a native window from whichever workspace owns it.
   *
   * @param window - Native window wrapper to remove from the session registry.
   */
  detachWindow(window: Window): void {
    const workspaceId = this.#sessionIdByWindowId.get(window.window.id);
    if (!workspaceId) return;

    this.#sessionsById.get(workspaceId)?.detachWindow(window);
    this.#sessionIdByWindowId.delete(window.window.id);
  }

  /**
   * Resolves the workspace session attached to a native browser window.
   *
   * @param window - BrowserWindow that may be attached to a workspace session.
   * @returns null when the window is unbound or unknown.
   */
  getForBrowserWindow(window: BrowserWindow): FontSessionHost | null {
    const workspaceId = this.#sessionIdByWindowId.get(window.id);
    return workspaceId ? this.get(workspaceId) : null;
  }

  /**
   * Resolves the workspace session attached to a renderer webContents.
   *
   * @param webContents - Renderer sender from an Electron IPC event.
   * @returns null when the sender does not belong to a bound workspace window.
   */
  getForWebContents(webContents: WebContents): FontSessionHost | null {
    const window = BrowserWindow.fromWebContents(webContents);
    return window ? this.getForBrowserWindow(window) : null;
  }

  /**
   * Returns the live workspace sessions.
   *
   * @returns a fresh array; mutating it does not change the registry.
   */
  list(): readonly FontSessionHost[] {
    return [...this.#sessionsById.values()];
  }

  #requireWorkspace(workspaceId: FontSessionId): FontSessionHost {
    const session = this.#sessionsById.get(workspaceId);
    if (!session) throw new Error(`Workspace session is not registered: ${workspaceId}`);
    return session;
  }

  async #createSession(
    load: (workspaceProcess: WorkspaceProcess) => Promise<WorkspaceDocumentState>,
  ): Promise<FontSessionHost> {
    const workspaceProcess = new WorkspaceProcess();
    workspaceProcess.start(this.#documentsRoot());

    try {
      await workspaceProcess.whenReady();
      const state = await load(workspaceProcess);
      const existing = this.get(state.workspaceId);
      if (existing) {
        workspaceProcess.stop();
        if (!existing.document)
          throw new Error(`Font session identity collision: ${state.workspaceId}`);
        existing.document.acceptState(state);
        return existing;
      }

      return this.#registerLoadedSession(workspaceProcess, state);
    } catch (error) {
      workspaceProcess.stop();
      throw error;
    }
  }

  #registerLoadedSession(
    workspaceProcess: WorkspaceProcess,
    state: WorkspaceDocumentState,
  ): FontSessionHost {
    const session = new FontSessionHost({
      mode: "authored",
      sessionId: state.workspaceId,
      workspaceProcess,
      documentClient: new DocumentClient(),
      applicationName: this.#applicationName,
      nativeDialogs: this.#nativeDialogs,
    });

    session.document?.acceptState(state);
    this.register(session);
    try {
      this.#documentSessions.update(session.workspaceId, state);
    } catch (error) {
      this.unregister(session.workspaceId);
      throw error;
    }

    return session;
  }

  async #openDocument(
    sourcePath: string,
    workspaceProcess: WorkspaceProcess,
  ): Promise<FontSessionHost> {
    const state = await workspaceProcess.openWorkspace(sourcePath);
    const existing = this.#sessionForDocumentState(state);
    if (existing) {
      workspaceProcess.stop();
      return existing;
    }

    return this.#registerLoadedSession(workspaceProcess, state);
  }

  #sessionForDocumentState(state: WorkspaceDocumentState): FontSessionHost | null {
    const byWorkspaceId = this.get(state.workspaceId);
    if (byWorkspaceId) return byWorkspaceId;

    const workspaceId = this.#documentSessions.workspaceIdForState(state);
    return workspaceId ? this.get(workspaceId) : null;
  }

  #sessionForDocument(identity: WorkspaceDocumentIdentity): FontSessionHost | null {
    const workspaceId = this.#documentSessions.workspaceIdForDocument(identity);
    return workspaceId ? this.get(workspaceId) : null;
  }

  async #openFontSource(sourcePath: string): Promise<FontSessionHost> {
    const workspaceProcess = new WorkspaceProcess();
    workspaceProcess.start(this.#documentsRoot());

    try {
      await workspaceProcess.whenReady();
      const state = await workspaceProcess.openFontSource(sourcePath);
      const existing = this.get(state.sessionId);
      if (existing) {
        workspaceProcess.stop();
        return existing;
      }

      const session = new FontSessionHost({
        mode: "preview",
        sessionId: state.sessionId,
        sourcePath: state.canonicalPath,
        workspaceProcess,
      });
      this.register(session);
      return session;
    } catch (error) {
      workspaceProcess.stop();
      throw error;
    }
  }
}

function isShiftDocumentPath(sourcePath: string): boolean {
  return path.extname(sourcePath).toLowerCase() === ".shift";
}
