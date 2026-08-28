import { app, BrowserWindow, shell } from "electron";
import type { ShiftLogger } from "../logging";
import { shiftProductVersion } from "../release";
import { getRendererSource } from "../utils";

/** Owns the singleton native-framed window that presents Shift product information. */
export class AboutWindow {
  readonly #preloadPath: string;
  readonly #log: ShiftLogger;

  #window: BrowserWindow | null = null;

  /**
   * Creates a lazily opened About window.
   *
   * @param preloadPath - compiled preload shared with other app windows.
   * @param log - logger that receives renderer and external-link failures.
   */
  constructor(preloadPath: string, log: ShiftLogger) {
    this.#preloadPath = preloadPath;
    this.#log = log;
  }

  /** Opens the About window, or focuses the existing instance. */
  show(): void {
    if (this.#window && !this.#window.isDestroyed()) {
      if (this.#window.isMinimized()) this.#window.restore();

      this.#window.show();
      this.#window.focus();
      return;
    }

    const window = new BrowserWindow({
      width: 420,
      height: 360,
      title: `About ${app.name}`,
      show: false,
      resizable: false,
      minimizable: false,
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
    window.on("closed", () => {
      if (this.#window === window) this.#window = null;
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (!url.startsWith("https://")) return { action: "deny" };

      void shell.openExternal(url).catch((error) => {
        this.#log.error("about link failed to open", { url, error });
      });
      return { action: "deny" };
    });

    this.#load(window);
  }

  #load(window: BrowserWindow): void {
    const source = getRendererSource();
    const query = new URLSearchParams({
      name: app.name,
      version: shiftProductVersion,
    });
    const hash = `/about?${query.toString()}`;

    if (source.type === "url") {
      const url = new URL(source.source);
      url.hash = hash;
      void window.loadURL(url.toString()).catch((error) => {
        this.#log.error("about window failed to load", error);
      });
      return;
    }

    void window.loadFile(source.source, { hash }).catch((error) => {
      this.#log.error("about window failed to load", error);
    });
  }
}
