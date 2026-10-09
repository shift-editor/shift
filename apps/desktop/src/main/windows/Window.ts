import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron";
import * as ipc from "../../shared/ipc/main";
import type { RendererCommandId } from "../../shared/commands";
import { AgentClient } from "../agent/AgentClient";
import type { TitleBarColors } from "../../shared/menu/types";

export interface WindowOptions {
  title?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  maximised?: boolean;
  preloadPath: string;
  browserWindowOptions?: BrowserWindowConstructorOptions;
  autoShow: boolean;
  /** Height of the renderer's title-bar row, which Windows' caption buttons match. */
  titleBarHeight?: number;
}

const WINDOW_DEFAULT_OPTIONS: Omit<WindowOptions, "preloadPath"> = {
  width: 800,
  height: 600,
  title: "Shift",
  minWidth: 1200,
  maximised: false,
  autoShow: false,
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

/** Height of the editor's toolbar row, which also hosts the window controls on Windows and Linux. */
const TITLE_BAR_HEIGHT = 50;

/** Light-theme chrome colours, used until the renderer reports its resolved theme. */
const INITIAL_TITLE_BAR_COLORS: TitleBarColors = { background: "#e2e2e2", symbol: "#171717" };

/**
 * Platform window chrome.
 *
 * - macOS: the renderer draws its own traffic lights.
 * - Windows: the system's caption buttons, drawn by Electron over Shift's
 *   toolbar row, keep Windows 11 snap layouts working.
 * - Linux: a frameless window; the renderer draws the window buttons in
 *   Shift's style, placed by the desktop's button layout.
 *
 * On Windows and Linux the renderer also draws the menus that would otherwise
 * sit in a native menu bar.
 */
function platformChrome(titleBarHeight: number): BrowserWindowConstructorOptions {
  switch (process.platform) {
    case "darwin":
      return { titleBarStyle: "hidden", trafficLightPosition: { x: -100, y: -100 } };
    case "win32":
      return {
        titleBarStyle: "hidden",
        titleBarOverlay: {
          color: INITIAL_TITLE_BAR_COLORS.background,
          symbolColor: INITIAL_TITLE_BAR_COLORS.symbol,
          height: titleBarHeight,
        },
      };
    default:
      return { frame: false };
  }
}

const BROWSER_WINDOW_DEFAULT_OPTIONS: BrowserWindowConstructorOptions = {
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  },
};

export class Window {
  readonly agent = new AgentClient();

  #window: BrowserWindow;
  #maximiseOnPresent: boolean;
  readonly #titleBarHeight: number;

  constructor(options: WindowOptions) {
    const windowOptions = { ...WINDOW_DEFAULT_OPTIONS, ...options };
    this.#maximiseOnPresent = windowOptions.maximised ?? false;
    this.#titleBarHeight = windowOptions.titleBarHeight ?? TITLE_BAR_HEIGHT;
    const browserWindowOptions = {
      ...platformChrome(this.#titleBarHeight),
      ...BROWSER_WINDOW_DEFAULT_OPTIONS,
      ...windowOptions.browserWindowOptions,
    };

    this.#window = new BrowserWindow({
      ...browserWindowOptions,
      width: windowOptions.width,
      height: windowOptions.height,
      title: windowOptions.title,
      minWidth: windowOptions.minWidth,
      show: false,
      webPreferences: {
        ...BROWSER_WINDOW_DEFAULT_OPTIONS.webPreferences,
        ...windowOptions.browserWindowOptions?.webPreferences,
        preload: windowOptions.preloadPath,
      },
    });

    // The native menu stays installed for its accelerators but is never shown.
    if (process.platform !== "darwin") this.#window.setMenuBarVisibility(false);

    if (windowOptions.autoShow) {
      this.#window.once("ready-to-show", () => {
        this.present();
      });
    }
  }

  get window(): BrowserWindow {
    return this.#window;
  }

  close(): void {
    this.#window.close();
  }

  present(): void {
    // Maximising a hidden window shows it already at full size, so it never
    // flashes at its normal bounds first.
    if (this.#maximiseOnPresent) {
      this.#maximiseOnPresent = false;
      this.#window.maximize();
    }

    this.#window.show();

    this.#window.focus();
  }

  focus(): void {
    if (this.#window.isMinimized()) {
      this.#window.restore();
    }

    this.#window.show();
    this.#window.focus();
  }

  /**
   * Recolours the native window controls to match the renderer's theme.
   *
   * @remarks
   * Only Windows windows have a title bar overlay; macOS and Linux ignore this.
   */
  setTitleBarColors(colors: TitleBarColors): void {
    if (process.platform !== "win32") return;

    this.#window.setTitleBarOverlay({
      color: colors.background,
      symbolColor: colors.symbol,
      height: this.#titleBarHeight,
    });
  }

  /** Updates the native window title shown by the operating system. */
  setTitle(title: string): void {
    this.#window.setTitle(title);
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

  /** Steps interface size up to the next ladder stop and notifies the renderer. */
  increaseInterfaceSize(): void {
    const current = zoomLevelToPercent(this.#window.webContents.getZoomLevel());
    const next = ZOOM_PERCENTS.find((percent) => percent > current + 1);
    this.#setZoomPercent(next ?? ZOOM_PERCENTS[ZOOM_PERCENTS.length - 1]!);
  }

  /** Steps interface size down to the previous ladder stop and notifies the renderer. */
  decreaseInterfaceSize(): void {
    const current = zoomLevelToPercent(this.#window.webContents.getZoomLevel());
    const previous = [...ZOOM_PERCENTS].reverse().find((percent) => percent < current - 1);
    this.#setZoomPercent(previous ?? ZOOM_PERCENTS[0]!);
  }

  /** Restores interface size to 100% and notifies the renderer. */
  resetInterfaceSize(): void {
    this.#setZoomPercent(100);
  }

  runRendererCommand(id: RendererCommandId): void {
    ipc.send(this.#window.webContents, "commands.runRenderer", id);
  }

  #setZoomPercent(percent: number): void {
    this.#window.webContents.setZoomLevel(percentToZoomLevel(percent));
    ipc.send(this.#window.webContents, "ui.zoomChanged", percent);
  }
}
