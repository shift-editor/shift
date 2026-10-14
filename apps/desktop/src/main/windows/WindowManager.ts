import { BrowserWindow } from "electron";
import type { Window } from "./Window";

/**
 * Tracks native windows independently from the workspaces they display.
 *
 * @remarks
 * Windows are renderer containers, not document authority. Workspace ownership
 * lives in `WorkspaceManager`; this manager should only answer window lifecycle
 * and lookup questions.
 */
export class WindowManager {
  readonly #windows = new Map<number, Window>();

  add(window: Window): void {
    this.#windows.set(window.window.id, window);
  }

  remove(window: Window): void {
    this.#windows.delete(window.window.id);
  }

  activeWindow(): Window | null {
    const focused = BrowserWindow.getFocusedWindow();
    return focused ? this.windowForBrowserWindow(focused) : null;
  }

  /**
   * The document window `window` belongs to: itself, or for a tool window such
   * as the feature code window, the document window that opened it, so menu
   * commands like Save act on that document.
   */
  windowForBrowserWindow(window: BrowserWindow): Window | null {
    const own = this.#windows.get(window.id);
    if (own) return own;
    for (const candidate of this.#windows.values()) {
      if (candidate.ownsToolWindow(window)) return candidate;
    }
    return null;
  }

  windowForId(windowId: number): Window | null {
    return this.#windows.get(windowId) ?? null;
  }

  allWindows(): readonly Window[] {
    return [...this.#windows.values()];
  }
}
