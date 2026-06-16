import { app, type Event } from "electron";
import type { ShiftLogger } from "../logging";
import type { Window } from "../windows/Window";
import type { CloseReason } from "../document/DocumentSession";

export type CloseConfirmation = {
  shouldConfirmClose(): boolean;
  confirmClose(reason: CloseReason): Promise<boolean>;
};

export type AppLifecycleOptions = {
  document: CloseConfirmation;
  log: ShiftLogger;
};

export type WindowLifecycleOptions = {
  onClosed: () => void;
};

type QuitState = "idle" | "confirming" | "confirmed";

/**
 * Coordinates Electron close and quit events around document vetoes.
 *
 * @remarks
 * Electron exposes window close and app quit as separate event paths. This
 * coordinator keeps their re-entrant state in one place and exposes a narrow
 * `registerWindow` surface to the app bootstrap.
 */
export class AppLifecycle {
  readonly #document: CloseConfirmation;
  readonly #log: ShiftLogger;

  #quitState: QuitState = "idle";
  #confirmedWindowCloses = new Set<number>();
  #pendingWindowCloses = new Set<number>();

  constructor(options: AppLifecycleOptions) {
    this.#document = options.document;
    this.#log = options.log;
  }

  /** Installs app-wide lifecycle handlers. */
  start(): void {
    app.on("before-quit", (event) => this.#handleBeforeQuit(event));
  }

  /** Registers close handling for one BrowserWindow wrapper. */
  registerWindow(window: Window, options: WindowLifecycleOptions): void {
    const windowId = window.window.id;

    window.window.on("close", (event) => this.#handleWindowClose(window, event));
    window.window.on("closed", () => {
      this.#confirmedWindowCloses.delete(windowId);
      this.#pendingWindowCloses.delete(windowId);
      options.onClosed();
    });
  }

  #handleWindowClose(window: Window, event: Event): void {
    const windowId = window.window.id;
    if (this.#quitState === "confirmed" || this.#confirmedWindowCloses.has(windowId)) return;
    if (!this.#document.shouldConfirmClose()) return;

    event.preventDefault();
    if (this.#pendingWindowCloses.has(windowId)) return;

    this.#pendingWindowCloses.add(windowId);
    void this.#document
      .confirmClose("window")
      .then((confirmed) => {
        if (!confirmed) return;

        this.#confirmedWindowCloses.add(windowId);
        window.close();
      })
      .catch((error) => {
        this.#log.error("window close guard failed", error);
      })
      .finally(() => {
        this.#pendingWindowCloses.delete(windowId);
      });
  }

  #handleBeforeQuit(event: Event): void {
    if (this.#quitState === "confirmed") return;
    if (!this.#document.shouldConfirmClose()) return;

    event.preventDefault();
    if (this.#quitState === "confirming") return;

    this.#quitState = "confirming";
    void this.#document
      .confirmClose("quit")
      .then((confirmed) => {
        if (!confirmed) {
          this.#quitState = "idle";
          return;
        }

        this.#quitState = "confirmed";
        app.quit();
      })
      .catch((error) => {
        this.#quitState = "idle";
        this.#log.error("quit guard failed", error);
      });
  }
}
