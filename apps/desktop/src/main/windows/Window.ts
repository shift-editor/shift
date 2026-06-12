import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron";
import * as ipc from "../../shared/ipc/main";

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

/** Chrome zoom steps, matching the browser-conventional ladder. */
const ZOOM_PERCENTS = [
  25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500,
];

function zoomLevelToPercent(zoomLevel: number): number {
  return Math.round(Math.pow(1.2, zoomLevel) * 100);
}

function percentToZoomLevel(percent: number): number {
  return Math.log(percent / 100) / Math.log(1.2);
}

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

  /** Steps UI (chrome) zoom up to the next ladder stop and notifies the renderer. */
  zoomIn(): void {
    const current = zoomLevelToPercent(this.#window.webContents.getZoomLevel());
    const next = ZOOM_PERCENTS.find((percent) => percent > current + 1);
    this.#setZoomPercent(next ?? ZOOM_PERCENTS[ZOOM_PERCENTS.length - 1]!);
  }

  /** Steps UI (chrome) zoom down to the previous ladder stop and notifies the renderer. */
  zoomOut(): void {
    const current = zoomLevelToPercent(this.#window.webContents.getZoomLevel());
    const previous = [...ZOOM_PERCENTS].reverse().find((percent) => percent < current - 1);
    this.#setZoomPercent(previous ?? ZOOM_PERCENTS[0]!);
  }

  /** Restores UI (chrome) zoom to 100% and notifies the renderer. */
  resetZoom(): void {
    this.#setZoomPercent(100);
  }

  #setZoomPercent(percent: number): void {
    this.#window.webContents.setZoomLevel(percentToZoomLevel(percent));
    ipc.send(this.#window.webContents, "ui.zoomChanged", percent);
  }
}
