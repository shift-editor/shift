import { app, BrowserWindow } from "electron";
import type { ShiftLogger } from "../logging";
import { getRendererSource } from "../utils";
import * as ipc from "../../shared/ipc/main";
import type { UpdateProgress } from "../../shared/update/types";

const INITIAL_PROGRESS: UpdateProgress = {
  percent: 0,
  transferred: 0,
  total: 0,
  bytesPerSecond: 0,
};

/** Owns the native-framed window that presents update download and install progress. */
export class UpdateWindow {
  readonly #preloadPath: string;
  readonly #log: ShiftLogger;
  readonly #onClosed: () => void;

  #window: BrowserWindow | null = null;
  #progress: UpdateProgress = INITIAL_PROGRESS;
  #availableVersion: string | null = null;
  #readyVersion: string | null = null;
  #closeRequested = false;

  /**
   * Creates a lazily opened update window.
   *
   * @param preloadPath - compiled preload script shared with other app windows.
   * @param log - logger that receives renderer loading failures.
   * @param onClosed - called only when the user closes the window frame.
   */
  constructor(preloadPath: string, log: ShiftLogger, onClosed: () => void) {
    this.#preloadPath = preloadPath;
    this.#log = log;
    this.#onClosed = onClosed;
  }

  /**
   * Opens or focuses the window with choices for an available update.
   *
   * @param version - product version available to download.
   */
  showAvailable(version: string): void {
    this.#availableVersion = version;
    this.#readyVersion = null;
    this.#open();
    this.#sendCurrent();
  }

  /** Opens or focuses the window in download-progress mode. */
  showDownloading(): void {
    if (
      this.#availableVersion !== null ||
      this.#readyVersion !== null ||
      !this.#window ||
      this.#window.isDestroyed()
    ) {
      this.#progress = INITIAL_PROGRESS;
    }
    this.#availableVersion = null;
    this.#readyVersion = null;
    this.#open();
    this.#sendCurrent();
  }

  /**
   * Updates the visible download progress and retains it across renderer loading.
   *
   * @param progress - latest cumulative byte and percentage measurements.
   */
  updateProgress(progress: UpdateProgress): void {
    this.#progress = progress;
    this.#sendCurrent();
  }

  /**
   * Replaces download progress with restart choices, opening the window when needed.
   *
   * @param version - downloaded product version presented to the user.
   */
  showReady(version: string): void {
    this.#availableVersion = null;
    this.#readyVersion = version;
    this.#open();
    this.#sendCurrent();
  }

  /** Closes the window without treating the close as a user cancellation. */
  close(): void {
    if (!this.#window || this.#window.isDestroyed()) return;

    this.#closeRequested = true;
    this.#window.close();
  }

  #open(): void {
    if (this.#window && !this.#window.isDestroyed()) {
      if (this.#window.isMinimized()) this.#window.restore();
      this.#window.show();
      this.#window.focus();
      return;
    }

    const window = new BrowserWindow({
      width: 480,
      height: 360,
      title: `Updating ${app.name}`,
      show: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      backgroundColor: "#ffffff",
      ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const } : {}),
      webPreferences: {
        preload: this.#preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    this.#window = window;
    window.setMenu(null);

    window.once("ready-to-show", () => {
      if (window.isDestroyed()) return;

      window.show();
      window.focus();
    });
    window.webContents.on("did-finish-load", () => this.#sendCurrent());
    window.on("closed", () => {
      const closeRequested = this.#closeRequested;
      if (this.#window === window) this.#window = null;
      this.#closeRequested = false;
      if (!closeRequested) this.#onClosed();
    });

    this.#load(window);
  }

  #load(window: BrowserWindow): void {
    const source = getRendererSource();
    const stateQuery = this.#availableVersion
      ? `?state=available&version=${encodeURIComponent(this.#availableVersion)}`
      : this.#readyVersion
        ? `?state=ready&version=${encodeURIComponent(this.#readyVersion)}`
        : "";
    const hash = `/update${stateQuery}`;

    if (source.type === "url") {
      const url = new URL(source.source);
      url.hash = hash;
      void window.loadURL(url.toString()).catch((error) => {
        this.#log.error("update window failed to load", error);
      });
      return;
    }

    void window.loadFile(source.source, { hash }).catch((error) => {
      this.#log.error("update window failed to load", error);
    });
  }

  #sendCurrent(): void {
    const window = this.#window;
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;

    if (this.#availableVersion) {
      ipc.send(window.webContents, "update.available", this.#availableVersion);
      return;
    }
    if (this.#readyVersion) {
      ipc.send(window.webContents, "update.ready", this.#readyVersion);
      return;
    }

    ipc.send(window.webContents, "update.progress", this.#progress);
  }
}
