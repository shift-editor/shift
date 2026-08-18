import { app, type Event } from "electron";
import type { DocumentSession, CloseReason } from "../document/DocumentSession";
import type { ShiftLogger } from "../logging";
import type { Window } from "../windows/Window";

export type AppLifecycleOptions = {
  documentForWindow: (window: Window) => DocumentSession | null;
  documents: () => readonly DocumentSession[];
  log: ShiftLogger;
};

export type WindowLifecycleOptions = {
  onClosed: () => void;
};

type QuitState = "idle" | "confirming" | "confirmed";

/** Coordinates window close, ordinary quit, and update restart around document vetoes. */
export class AppLifecycle {
  readonly #documentForWindow: (window: Window) => DocumentSession | null;
  readonly #documents: () => readonly DocumentSession[];
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
  }

  /** Registers close handling for one BrowserWindow wrapper. */
  registerWindow(window: Window, options: WindowLifecycleOptions): void {
    const windowId = window.window.id;
    this.#log.info("registering window lifecycle", { windowId });

    window.window.on("close", (event) => this.#handleWindowClose(window, event));
    window.window.on("closed", () => {
      this.#confirmedWindowCloses.delete(windowId);
      this.#pendingWindowCloses.delete(windowId);
      options.onClosed();
    });
  }

  /** Prepares and commits every document before an ordinary quit or update restart. */
  async confirmQuit(reason: CloseReason): Promise<boolean> {
    if (this.#quitState === "confirmed") return true;
    if (this.#quitConfirmation) return this.#quitConfirmation;

    this.#quitState = "confirming";
    const confirmation = this.#prepareAndCommitDocuments(reason);
    this.#quitConfirmation = confirmation;

    try {
      const confirmed = await confirmation;
      this.#quitState = confirmed ? "confirmed" : "idle";
      return confirmed;
    } catch (error) {
      this.#quitState = "idle";
      throw error;
    } finally {
      if (this.#quitConfirmation === confirmation) this.#quitConfirmation = null;
    }
  }

  #handleWindowClose(window: Window, event: Event): void {
    const windowId = window.window.id;
    if (this.#quitState === "confirmed" || this.#confirmedWindowCloses.has(windowId)) return;
    if (this.#quitState === "confirming") {
      event.preventDefault();
      return;
    }

    const document = this.#documentForWindow(window);
    if (!document?.shouldConfirmClose()) return;

    event.preventDefault();
    if (this.#pendingWindowCloses.has(windowId)) return;
    this.#pendingWindowCloses.add(windowId);

    void this.#closeWindow(window, document)
      .catch((error) => {
        this.#log.error("window close failed", error);
      })
      .finally(() => {
        this.#pendingWindowCloses.delete(windowId);
      });
  }

  async #closeWindow(window: Window, document: DocumentSession): Promise<void> {
    const windowId = window.window.id;
    let prepared: boolean;
    try {
      prepared = await document.prepareClose("window");
    } catch (error) {
      document.cancelClose();
      this.#log.error("window close preparation failed", error);
      return;
    }

    if (!prepared) {
      document.cancelClose();
      return;
    }

    try {
      await document.commitClose();
    } catch (error) {
      this.#log.error("window document close failed after commit", error);
    }

    this.#confirmedWindowCloses.add(windowId);
    window.close();
  }

  #handleBeforeQuit(event: Event): void {
    if (this.#quitState === "confirmed") return;
    if (this.#documents().length === 0) return;

    event.preventDefault();
    if (this.#quitState === "confirming") return;

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
    const prepared: DocumentSession[] = [];

    try {
      for (const document of documents) {
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

    const results = await Promise.allSettled(prepared.map((document) => document.commitClose()));
    for (const result of results) {
      if (result.status === "rejected") {
        this.#log.error("document close failed after commit", result.reason);
      }
    }

    return true;
  }
}
