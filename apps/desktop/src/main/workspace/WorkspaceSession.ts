import { BrowserWindow } from "electron";
import { DocumentClient } from "../document/DocumentClient";
import { DocumentSession } from "../document/DocumentSession";
import type { Window } from "../windows/Window";
import { WorkspaceProcess } from "./WorkspaceProcess";

/** Stable identity for one live font session. */
export type FontSessionId = string;

/** Compatibility name for authored package indexing. */
export type WorkspaceId = FontSessionId;

export type FontSessionOptions =
  | {
      readonly kind: "workspace";
      readonly sessionId: FontSessionId;
      readonly workspaceProcess: WorkspaceProcess;
      readonly documentClient: DocumentClient;
      readonly applicationName: () => string;
    }
  | {
      readonly kind: "source";
      readonly sessionId: FontSessionId;
      readonly workspaceProcess: WorkspaceProcess;
    };

/**
 * Groups the process, capabilities, and windows for one open font.
 *
 * Authored sessions additionally own document workflows. Retained source
 * sessions deliberately have no document client, persistence, dirty state, or
 * save target.
 */
export class FontSession {
  readonly kind: "workspace" | "source";
  readonly sessionId: FontSessionId;
  readonly workspaceProcess: WorkspaceProcess;
  readonly documentClient: DocumentClient | null;
  readonly document: DocumentSession | null;
  readonly windows = new Set<Window>();

  readonly #unlistenDocumentChanged: () => void;
  readonly #unlistenWorkspaceExit: () => void;

  constructor(options: FontSessionOptions) {
    this.kind = options.kind;
    this.sessionId = options.sessionId;
    this.workspaceProcess = options.workspaceProcess;

    switch (options.kind) {
      case "workspace":
        this.documentClient = options.documentClient;
        this.document = new DocumentSession({
          document: this.documentClient,
          closeDocument: async (discard) => {
            await this.workspaceProcess.closeWorkspace(discard);
          },
          dialogWindow: () => this.activeWindow(),
          windows: () => this.allWindows(),
          applicationName: options.applicationName,
        });
        this.#unlistenDocumentChanged = this.workspaceProcess.onDocumentChanged((state) => {
          this.document?.acceptState(state);
        });
        this.#unlistenWorkspaceExit = this.workspaceProcess.onExit(() => {
          this.documentClient?.dispose();
        });
        break;
      case "source":
        this.documentClient = null;
        this.document = null;
        this.#unlistenDocumentChanged = () => {};
        this.#unlistenWorkspaceExit = () => {};
        break;
    }
  }

  /** Compatibility identity used by authored package indexing. */
  get workspaceId(): WorkspaceId {
    return this.sessionId;
  }

  attachWindow(window: Window): void {
    this.windows.add(window);
  }

  detachWindow(window: Window): void {
    this.windows.delete(window);
  }

  activeWindow(): Window | null {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      for (const window of this.windows) {
        if (window.window.id === focused.id) return window;
      }
    }

    return this.windows.values().next().value ?? null;
  }

  allWindows(): readonly Window[] {
    return [...this.windows];
  }

  dispose(): void {
    this.#unlistenDocumentChanged();
    this.#unlistenWorkspaceExit();
    this.documentClient?.dispose();
    this.workspaceProcess.stop();
    this.windows.clear();
  }
}

/** Compatibility type for authored-only callers. */
export type WorkspaceSession = FontSession;
