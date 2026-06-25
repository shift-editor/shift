import { BrowserWindow } from "electron";
import { DocumentClient } from "../document/DocumentClient";
import { DocumentSession } from "../document/DocumentSession";
import type { Window } from "../windows/Window";
import { WorkspaceProcess } from "./WorkspaceProcess";

/**
 * Identifies one live loaded font workspace.
 *
 * @remarks
 * Renderer windows attach to this identity and keep it for their lifetime.
 */
export type WorkspaceId = string;

export interface WorkspaceSessionOptions {
  readonly workspaceId: WorkspaceId;
  readonly workspaceProcess: WorkspaceProcess;
  readonly documentClient: DocumentClient;
  readonly applicationName: () => string;
}

/**
 * Groups the main-process services and windows for one font workspace.
 *
 * @remarks
 * The workspace owns persistence, dirty state, undo state, and sync-lane
 * access. Windows are views attached to this session.
 */
export class WorkspaceSession {
  /** Stable identity for this live workspace session. */
  readonly workspaceId: WorkspaceId;

  /** Utility process that owns this workspace's font data and sync lanes. */
  readonly workspaceProcess: WorkspaceProcess;

  /** Renderer-mediated document lane for save/state requests that must flush edits. */
  readonly documentClient: DocumentClient;

  /** Main-owned document workflow for this workspace. */
  readonly document: DocumentSession;

  /** Renderer windows currently attached to this workspace session. */
  readonly windows = new Set<Window>();

  readonly #unlistenDocumentChanged: () => void;

  /**
   * Creates a session around the services for one loaded font workspace.
   *
   * @param options - Services and identity that remain stable for this session lifetime.
   */
  constructor(options: WorkspaceSessionOptions) {
    this.workspaceId = options.workspaceId;
    this.workspaceProcess = options.workspaceProcess;
    this.documentClient = options.documentClient;
    this.document = new DocumentSession({
      document: this.documentClient,
      dialogWindow: () => this.activeWindow(),
      windows: () => this.allWindows(),
      applicationName: options.applicationName,
    });
    this.#unlistenDocumentChanged = this.workspaceProcess.onDocumentChanged((state) => {
      this.document.acceptState(state);
    });
  }

  /**
   * Attaches a renderer window to this workspace session.
   *
   * @param window - Native window wrapper that should display this workspace.
   */
  attachWindow(window: Window): void {
    this.windows.add(window);
  }

  /**
   * Detaches a renderer window from this workspace session.
   *
   * @param window - Native window wrapper that no longer displays this workspace.
   */
  detachWindow(window: Window): void {
    this.windows.delete(window);
  }

  /**
   * Returns a window suitable for workspace-owned dialogs.
   *
   * @returns the focused session window, a remaining attached window, or null.
   */
  activeWindow(): Window | null {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      for (const window of this.windows) {
        if (window.window.id === focused.id) return window;
      }
    }

    return this.windows.values().next().value ?? null;
  }

  /**
   * Returns the renderer windows attached to this session.
   *
   * @returns a fresh array; mutating it does not change the session.
   */
  allWindows(): readonly Window[] {
    return [...this.windows];
  }

  /** Disposes process and renderer-facing document resources for this workspace. */
  dispose(): void {
    this.#unlistenDocumentChanged();
    this.documentClient.dispose();
    this.workspaceProcess.stop();
    this.windows.clear();
  }
}
