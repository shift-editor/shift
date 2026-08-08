import { BrowserWindow } from "electron";
import { DocumentClient } from "../document/DocumentClient";
import { DocumentSession } from "../document/DocumentSession";
import type { FontSessionMode } from "../../shared/workspace/protocol";
import type { Window } from "../windows/Window";
import { WorkspaceProcess } from "./WorkspaceProcess";

/** Stable identity for one live font session. */
export type FontSessionId = string;

export type FontSessionHostOptions =
  | {
      readonly mode: "authored";
      readonly sessionId: FontSessionId;
      readonly workspaceProcess: WorkspaceProcess;
      readonly documentClient: DocumentClient;
      readonly applicationName: () => string;
    }
  | {
      readonly mode: "imported";
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
export class FontSessionHost {
  readonly mode: FontSessionMode;
  readonly sessionId: FontSessionId;
  readonly workspaceProcess: WorkspaceProcess;
  readonly documentClient: DocumentClient | null;
  readonly document: DocumentSession | null;
  readonly windows = new Set<Window>();

  readonly #unlistenDocumentChanged: () => void;
  readonly #unlistenWorkspaceExit: () => void;

  constructor(options: FontSessionHostOptions) {
    this.mode = options.mode;
    this.sessionId = options.sessionId;
    this.workspaceProcess = options.workspaceProcess;

    switch (options.mode) {
      case "authored":
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
      case "imported":
        this.documentClient = null;
        this.document = null;
        this.#unlistenDocumentChanged = () => {};
        this.#unlistenWorkspaceExit = () => {};
        break;
    }
  }

  /** Identity used by authored package indexing. */
  get workspaceId(): FontSessionId {
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
