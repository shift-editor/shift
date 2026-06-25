import { app, type Event } from "electron";
import type { ShiftLogger } from "../logging";
import type { Window } from "../windows/Window";
import type { CloseReason } from "../document/DocumentSession";

export type CloseConfirmation = {
  shouldConfirmClose(): boolean;
  confirmClose(reason: CloseReason): Promise<boolean>;
};

export type AppLifecycleOptions = {
  documentForWindow: (window: Window) => CloseConfirmation | null;
  documents: () => readonly CloseConfirmation[];
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
 * `registerWindow` surface to app startup.
 */
export class AppLifecycle {
  readonly #documentForWindow: (window: Window) => CloseConfirmation | null;
  readonly #documents: () => readonly CloseConfirmation[];
  readonly #log: ShiftLogger;

  #quitState: QuitState = "idle";
  #confirmedWindowCloses = new Set<number>();
  #pendingWindowCloses = new Set<number>();

  constructor(options: AppLifecycleOptions) {
    this.#documentForWindow = options.documentForWindow;
    this.#documents = options.documents;
    this.#log = options.log;
  }

  /** Installs app-wide lifecycle handlers. */
  start(): void {
    this.#log.info("starting app lifecycle");
    app.on("before-quit", (event) => this.#handleBeforeQuit(event));
  }

  /** Registers close handling for one BrowserWindow wrapper. */
  registerWindow(window: Window, options: WindowLifecycleOptions): void {
    const windowId = window.window.id;
    this.#log.info("registering window lifecycle", { windowId });

    window.window.on("close", (event) => this.#handleWindowClose(window, event));
    window.window.on("closed", () => {
      this.#log.info("window closed", { windowId });
      this.#confirmedWindowCloses.delete(windowId);
      this.#pendingWindowCloses.delete(windowId);
      options.onClosed();
    });
  }

  #handleWindowClose(window: Window, event: Event): void {
    const windowId = window.window.id;
    this.#log.debug("window close requested", { windowId, quitState: this.#quitState });
    if (this.#quitState === "confirmed" || this.#confirmedWindowCloses.has(windowId)) {
      this.#log.debug("window close allowed without guard", {
        windowId,
        quitState: this.#quitState,
      });
      return;
    }

    const document = this.#documentForWindow(window);
    if (!document?.shouldConfirmClose()) {
      this.#log.debug("window close guard skipped", { windowId });
      return;
    }

    event.preventDefault();
    if (this.#pendingWindowCloses.has(windowId)) {
      this.#log.debug("window close guard already pending", { windowId });
      return;
    }

    this.#pendingWindowCloses.add(windowId);
    this.#log.info("window close guard started", { windowId });
    void document
      .confirmClose("window")
      .then((confirmed) => {
        if (!confirmed) {
          this.#log.info("window close canceled by document guard", { windowId });
          return;
        }

        this.#log.info("window close confirmed by document guard", { windowId });
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
    this.#log.debug("before quit received", { quitState: this.#quitState });
    if (this.#quitState === "confirmed") {
      this.#log.debug("quit allowed after confirmation");
      return;
    }

    const documents = this.#documents().filter((document) => document.shouldConfirmClose());
    if (documents.length === 0) {
      this.#log.info("quit guard skipped");
      return;
    }

    event.preventDefault();
    if (this.#quitState === "confirming") {
      this.#log.debug("quit guard already running");
      return;
    }

    this.#quitState = "confirming";
    this.#log.info("quit guard started");
    void this.#confirmQuit(documents)
      .then((confirmed) => {
        if (!confirmed) {
          this.#quitState = "idle";
          this.#log.info("quit canceled by document guard");
          return;
        }

        this.#quitState = "confirmed";
        this.#log.info("quit confirmed by document guard");
        app.quit();
      })
      .catch((error) => {
        this.#quitState = "idle";
        this.#log.error("quit guard failed", error);
      });
  }

  async #confirmQuit(documents: readonly CloseConfirmation[]): Promise<boolean> {
    for (const document of documents) {
      if (!(await document.confirmClose("quit"))) return false;
    }

    return true;
  }
}
