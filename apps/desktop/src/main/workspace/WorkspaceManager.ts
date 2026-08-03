import { BrowserWindow, type WebContents } from "electron";
import path from "node:path";
import { DocumentClient } from "../document/DocumentClient";
import type { Window } from "../windows/Window";
import type {
  WorkspaceDocumentState,
  WorkspacePackageIdentity,
} from "../../shared/workspace/protocol";
import { WorkspaceProcess } from "./WorkspaceProcess";
import { FontSession, type FontSessionId, type WorkspaceId } from "./WorkspaceSession";
import { PackageSessionIndex } from "./PackageSessionIndex";

/** Provides app-owned values required when a workspace session is created. */
export interface WorkspaceManagerOptions {
  readonly documentsRoot: () => string;
  readonly applicationName: () => string;
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
  readonly #sessionsById = new Map<FontSessionId, FontSession>();
  readonly #sessionIdByWindowId = new Map<number, WorkspaceId>();
  readonly #packageSessions = new PackageSessionIndex();

  /**
   * Creates a manager for live font workspace sessions.
   *
   * @param options - Callbacks that provide app-level values when a session is created.
   */
  constructor(options: WorkspaceManagerOptions) {
    this.#documentsRoot = options.documentsRoot;
    this.#applicationName = options.applicationName;
  }

  /**
   * Creates an untitled workspace session.
   *
   * @returns the live session that owns the new workspace.
   */
  async createUntitled(): Promise<FontSession> {
    return this.#createSession((workspaceProcess) => workspaceProcess.createWorkspace());
  }

  /**
   * Opens a font source path in a workspace session.
   *
   * @param sourcePath - User-selected font source path.
   * @returns a live session for the opened source; existing sessions are reused by workspace id.
   */
  async openPath(sourcePath: string): Promise<FontSession> {
    if (isRetainedSourcePath(sourcePath)) return this.#openFontSource(sourcePath);

    const workspaceProcess = new WorkspaceProcess();
    workspaceProcess.start(this.#documentsRoot());

    try {
      await workspaceProcess.whenReady();

      const identity = isShiftPackagePath(sourcePath)
        ? await workspaceProcess.inspectPackage(sourcePath)
        : null;
      const existingBeforeOpen = identity ? this.#sessionForPackage(identity) : null;
      if (existingBeforeOpen) {
        workspaceProcess.stop();
        return existingBeforeOpen;
      }

      const state = await workspaceProcess.openWorkspace(sourcePath);
      const existingAfterOpen = this.#sessionForDocumentState(state);
      if (existingAfterOpen) {
        workspaceProcess.stop();
        if (!existingAfterOpen.document) {
          throw new Error(`Font session identity collision: ${state.documentId}`);
        }
        existingAfterOpen.document.acceptState(state);
        return existingAfterOpen;
      }

      return this.#registerLoadedSession(workspaceProcess, state);
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
  get(workspaceId: FontSessionId): FontSession | null {
    return this.#sessionsById.get(workspaceId) ?? null;
  }

  /**
   * Registers one live workspace session.
   *
   * @param session - Workspace session that is not already registered.
   * @throws {Error} when another session already uses the same workspace id.
   */
  register(session: FontSession): void {
    if (this.#sessionsById.has(session.workspaceId)) {
      throw new Error(`Workspace session already registered: ${session.workspaceId}`);
    }

    if (session.kind !== "source") this.#packageSessions.track(session);
    this.#sessionsById.set(session.workspaceId, session);
  }

  /**
   * Removes a workspace session and all of its window associations.
   *
   * @param workspaceId - Stable identity for the session to remove.
   */
  unregister(workspaceId: WorkspaceId): void {
    const session = this.#sessionsById.get(workspaceId);
    if (!session) return;

    for (const window of session.windows) {
      this.#sessionIdByWindowId.delete(window.window.id);
    }
    this.#packageSessions.untrack(workspaceId);
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
  attachWindow(workspaceId: WorkspaceId, window: Window): void {
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
  getForBrowserWindow(window: BrowserWindow): FontSession | null {
    const workspaceId = this.#sessionIdByWindowId.get(window.id);
    return workspaceId ? this.get(workspaceId) : null;
  }

  /**
   * Resolves the workspace session attached to a renderer webContents.
   *
   * @param webContents - Renderer sender from an Electron IPC event.
   * @returns null when the sender does not belong to a bound workspace window.
   */
  getForWebContents(webContents: WebContents): FontSession | null {
    const window = BrowserWindow.fromWebContents(webContents);
    return window ? this.getForBrowserWindow(window) : null;
  }

  /**
   * Returns the live workspace sessions.
   *
   * @returns a fresh array; mutating it does not change the registry.
   */
  list(): readonly FontSession[] {
    return [...this.#sessionsById.values()];
  }

  #requireWorkspace(workspaceId: WorkspaceId): FontSession {
    const session = this.#sessionsById.get(workspaceId);
    if (!session) throw new Error(`Workspace session is not registered: ${workspaceId}`);
    return session;
  }

  async #createSession(
    load: (workspaceProcess: WorkspaceProcess) => Promise<WorkspaceDocumentState>,
  ): Promise<FontSession> {
    const workspaceProcess = new WorkspaceProcess();
    workspaceProcess.start(this.#documentsRoot());

    try {
      await workspaceProcess.whenReady();
      const state = await load(workspaceProcess);
      const existing = this.get(state.documentId);
      if (existing) {
        workspaceProcess.stop();
        if (!existing.document)
          throw new Error(`Font session identity collision: ${state.documentId}`);
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
  ): FontSession {
    const session = new FontSession({
      kind: "workspace",
      sessionId: state.documentId,
      workspaceProcess,
      documentClient: new DocumentClient(),
      applicationName: this.#applicationName,
    });

    session.document?.acceptState(state);
    this.register(session);
    try {
      this.#packageSessions.update(session.workspaceId, state);
    } catch (error) {
      this.unregister(session.workspaceId);
      throw error;
    }

    return session;
  }

  #sessionForDocumentState(state: WorkspaceDocumentState): FontSession | null {
    const byDocumentId = this.get(state.documentId);
    if (byDocumentId) return byDocumentId;

    const workspaceId = this.#packageSessions.workspaceIdForState(state);
    return workspaceId ? this.get(workspaceId) : null;
  }

  #sessionForPackage(identity: WorkspacePackageIdentity): FontSession | null {
    const workspaceId = this.#packageSessions.workspaceIdForPackage(identity);
    return workspaceId ? this.get(workspaceId) : null;
  }

  async #openFontSource(sourcePath: string): Promise<FontSession> {
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

      const session = new FontSession({
        kind: "source",
        sessionId: state.sessionId,
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

function isShiftPackagePath(sourcePath: string): boolean {
  return path.extname(sourcePath).toLowerCase() === ".shift";
}

function isRetainedSourcePath(sourcePath: string): boolean {
  switch (path.extname(sourcePath).toLowerCase()) {
    case ".ttf":
    case ".otf":
      return true;
    default:
      return false;
  }
}
