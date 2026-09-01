import { BrowserWindow, shell } from "electron";
import type { ShiftLogger } from "../logging";
import { getRendererSource } from "../utils";
import {
  SHIFT_FEEDBACK_DISCORD_URL,
  SHIFT_FEEDBACK_EMAIL,
  SHIFT_NEW_ISSUE_URL,
} from "../../shared/links";

/** Owns the singleton modeless window for composing and routing user feedback. */
export class FeedbackWindow {
  readonly #preloadPath: string;
  readonly #log: ShiftLogger;

  #window: BrowserWindow | null = null;

  /**
   * Creates a lazily opened feedback window.
   *
   * @param preloadPath - compiled preload shared with other app windows.
   * @param log - logger that receives renderer and external-link failures.
   */
  constructor(preloadPath: string, log: ShiftLogger) {
    this.#preloadPath = preloadPath;
    this.#log = log;
  }

  /** Opens the feedback window, or focuses its existing draft. */
  show(): void {
    if (this.#window && !this.#window.isDestroyed()) {
      if (this.#window.isMinimized()) this.#window.restore();

      this.#window.show();
      this.#window.focus();
      return;
    }

    const window = new BrowserWindow({
      width: 520,
      height: 430,
      title: "Feedback",
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
      if (
        url !== SHIFT_NEW_ISSUE_URL &&
        url !== SHIFT_FEEDBACK_DISCORD_URL &&
        (!url.startsWith(`mailto:${SHIFT_FEEDBACK_EMAIL}?body=`) ||
          url.slice(`mailto:${SHIFT_FEEDBACK_EMAIL}?body=`.length).includes("&"))
      ) {
        return { action: "deny" };
      }

      void shell.openExternal(url).catch((error) => {
        this.#log.error("feedback link failed to open", { url, error });
      });
      return { action: "deny" };
    });

    this.#load(window);
  }

  #load(window: BrowserWindow): void {
    const source = getRendererSource();

    if (source.type === "url") {
      const url = new URL(source.source);
      url.hash = "/feedback";
      void window.loadURL(url.toString()).catch((error) => {
        this.#log.error("feedback window failed to load", error);
      });
      return;
    }

    void window.loadFile(source.source, { hash: "/feedback" }).catch((error) => {
      this.#log.error("feedback window failed to load", error);
    });
  }
}
