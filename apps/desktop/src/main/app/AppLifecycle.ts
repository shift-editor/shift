import { app, type Event } from "electron";
import type { CloseReason } from "../document/types";
import type { ShiftLogger } from "../logging";
import type { Window } from "../windows/Window";

export type CloseConfirmation = {
  shouldConfirmClose(): boolean;
  prepareClose(reason: CloseReason): Promise<boolean>;
  commitClose(): Promise<void>;
  cancelClose(): void;
};

export type AppLifecycleOptions = {
  documentForWindow: (window: Window) => CloseConfirmation | null;
  documents: () => readonly CloseConfirmation[];
  log: ShiftLogger;
};

export type WindowLifecycleOptions = {
  onClosed: () => void;
};

type QuitState = "idle" | "confirming" | "confirmed" | "terminating";

/** Coordinates window close, ordinary quit, and update restart around document vetoes. */
export class AppLifecycle {
  readonly #documentForWindow: (window: Window) => CloseConfirmation | null;
  readonly #documents: () => readonly CloseConfirmation[];
  readonly #log: ShiftLogger;

  #quitState: QuitState = "idle";
  #quitConfirmation: Promise<boolean> | null = null;
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

    if (!app.isPackaged) {
      // Electron installs its own POSIX signal handlers after loading main.
      // Register after readiness so they cannot replace our forced-exit path.
      app.once("ready", () => {
        process.on("SIGINT", () => this.terminate());
        process.on("SIGTERM", () => this.terminate());
      });
    }
  }

  /** Reports whether forced termination has permanently superseded document close flows. */
  get terminating(): boolean {
    return this.#quitState === "terminating";
  }

  /**
   * Force-kills the process without saving, discarding, or preparing document closes.
   *
   * @remarks
   * Terminal termination is irreversible from any quit state and bypasses Electron
   * teardown. Completed recovery transactions remain on disk; edits still in flight
   * are not guaranteed to survive. The parent observes SIGKILL rather than exit code 0.
   *
   * @throws {Error} when the operating system rejects the termination signal.
   */
  terminate(): void {
    if (this.terminating) return;

    this.#quitState = "terminating";
    this.#log.info("terminal termination requested; preserving document recovery");
    // app.exit() still runs Chromium teardown, which can restart already-killed
    // child processes when a terminal signal reaches the whole process group.
    process.kill(process.pid, "SIGKILL");
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

  /** Prepares and commits every document before an ordinary quit or update restart. */
  async confirmQuit(reason: CloseReason): Promise<boolean> {
    this.#log.debug("quit confirmation requested", { reason, quitState: this.#quitState });
    if (this.terminating) return false;
    if (this.#quitState === "confirmed") return true;
    if (this.#quitConfirmation) return this.#quitConfirmation;

    this.#quitState = "confirming";
    this.#log.info("quit preparation started", { reason });
    const confirmation = this.#prepareAndCommitDocuments(reason);
    this.#quitConfirmation = confirmation;

    try {
      const confirmed = await confirmation;
      if (this.terminating) return false;

      this.#quitState = confirmed ? "confirmed" : "idle";
      this.#log.info(confirmed ? "quit preparation committed" : "quit preparation canceled", {
        reason,
      });
      return confirmed;
    } catch (error) {
      if (!this.terminating) this.#quitState = "idle";
      this.#log.error("quit preparation failed", { reason, error });
      throw error;
    } finally {
      if (this.#quitConfirmation === confirmation) this.#quitConfirmation = null;
    }
  }

  #handleWindowClose(window: Window, event: Event): void {
    const windowId = window.window.id;
    this.#log.debug("window close requested", { windowId, quitState: this.#quitState });
    if (
      this.terminating ||
      this.#quitState === "confirmed" ||
      this.#confirmedWindowCloses.has(windowId)
    ) {
      this.#log.debug("window close allowed without guard", {
        windowId,
        quitState: this.#quitState,
      });
      return;
    }
    if (this.#quitState === "confirming") {
      this.#log.debug("window close blocked by quit preparation", { windowId });
      event.preventDefault();
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
    this.#log.info("window close preparation started", { windowId });

    void this.#closeWindow(window, document)
      .catch((error) => {
        this.#log.error("window close failed", error);
      })
      .finally(() => {
        this.#pendingWindowCloses.delete(windowId);
      });
  }

  async #closeWindow(window: Window, document: CloseConfirmation): Promise<void> {
    const windowId = window.window.id;
    let prepared: boolean;
    try {
      prepared = await document.prepareClose("window");
    } catch (error) {
      document.cancelClose();
      this.#log.error("window close preparation failed", error);
      return;
    }

    if (this.terminating) return;

    if (!prepared) {
      document.cancelClose();
      this.#log.info("window close canceled by document guard", { windowId });
      return;
    }

    try {
      await document.commitClose();
    } catch (error) {
      this.#log.error("window document close failed after commit", error);
      return;
    }

    this.#log.info("window close committed", { windowId });
    this.#confirmedWindowCloses.add(windowId);
    window.close();
  }

  #handleBeforeQuit(event: Event): void {
    this.#log.debug("before quit received", { quitState: this.#quitState });
    if (this.terminating || this.#quitState === "confirmed") {
      this.#log.debug("quit allowed without document preparation");
      return;
    }
    if (this.#documents().length === 0) {
      this.#log.info("quit guard skipped");
      return;
    }

    event.preventDefault();
    if (this.#quitState === "confirming") {
      this.#log.debug("quit guard already running");
      return;
    }

    void this.confirmQuit("quit")
      .then((confirmed) => {
        if (confirmed) app.quit();
      })
      .catch((error) => {
        this.#log.error("quit guard failed", error);
      });
  }

  async #prepareAndCommitDocuments(reason: CloseReason): Promise<boolean> {
    const documents = this.#documents();
    const prepared: CloseConfirmation[] = [];

    try {
      for (const document of documents) {
        if (this.terminating) return false;

        prepared.push(document);
        if (!(await document.prepareClose(reason))) {
          for (const candidate of prepared) candidate.cancelClose();
          return false;
        }
      }
    } catch (error) {
      for (const document of prepared) document.cancelClose();
      throw error;
    }

    if (this.terminating) return false;

    const results = await Promise.allSettled(prepared.map((document) => document.commitClose()));
    const failures: unknown[] = [];
    for (const result of results) {
      switch (result.status) {
        case "fulfilled":
          break;
        case "rejected":
          failures.push(result.reason);
          this.#log.error("document close failed after commit", result.reason);
          break;
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, "One or more documents could not be closed");
    }

    return true;
  }
}
