import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron";

export interface WindowOptions {
  title?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  maximised?: boolean;
  preloadPath: string;
  browserWindowOptions?: BrowserWindowConstructorOptions;
}

const WINDOW_DEFAULT_OPTIONS: Omit<WindowOptions, "preloadPath"> = {
  width: 800,
  height: 600,
  title: "Shift",
  minWidth: 1200,
  maximised: false,
};

const BROWSER_WINDOW_DEFAULT_OPTIONS: BrowserWindowConstructorOptions = {
  titleBarStyle: "hidden",
  trafficLightPosition: { x: -100, y: -100 },
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  },
};

export class Window {
  #window: BrowserWindow;

  constructor(options: WindowOptions) {
    const windowOptions = { ...WINDOW_DEFAULT_OPTIONS, ...options };
    const browserWindowOptions = {
      ...BROWSER_WINDOW_DEFAULT_OPTIONS,
      ...windowOptions.browserWindowOptions,
    };

    this.#window = new BrowserWindow({
      ...browserWindowOptions,
      width: windowOptions.width,
      height: windowOptions.height,
      title: windowOptions.title,
      minWidth: windowOptions.minWidth,
      show: windowOptions.maximised,
      webPreferences: {
        ...BROWSER_WINDOW_DEFAULT_OPTIONS.webPreferences,
        ...windowOptions.browserWindowOptions?.webPreferences,
        preload: windowOptions.preloadPath,
      },
    });

    if (windowOptions.maximised) {
      this.#window.maximize();
    }

    this.#window.once("ready-to-show", () => {
      this.#window.show();
    });
  }

  get window(): BrowserWindow {
    return this.#window;
  }

  close(): void {
    this.#window.close();
  }

  minimize(): void {
    this.#window.minimize();
  }

  toggleMaximize(): void {
    if (this.#window.isMaximized()) {
      this.#window.unmaximize();
    } else {
      this.#window.maximize();
    }
  }
}
