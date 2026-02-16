import { app, BrowserWindow, globalShortcut, ipcMain, dialog } from "electron";
import path from "node:path";
import type { DocumentState } from "./DocumentState";
import type { WindowManager } from "./WindowManager";
import type { MenuManager } from "./MenuManager";
import { extractFirstFontPath, normalizeFontPath } from "./openFontPath";
import * as ipc from "../../shared/ipc/main";

export class AppLifecycle {
  private documentState: DocumentState;
  private windowManager: WindowManager;
  private menuManager: MenuManager;
  private isQuitting = false;
  private pendingExternalOpenPaths: string[] = [];
  private processingExternalOpenPath = false;

  constructor(
    documentState: DocumentState,
    windowManager: WindowManager,
    menuManager: MenuManager,
  ) {
    this.documentState = documentState;
    this.windowManager = windowManager;
    this.menuManager = menuManager;
  }

  initialize() {
    this.registerAppEvents();
    this.registerIpcHandlers();
  }

  public handleLaunchArgs(argv: readonly string[]): void {
    const filePath = extractFirstFontPath(argv);
    if (!filePath) return;
    this.enqueueExternalOpenPath(filePath);
  }

  public handleSecondInstance(argv: readonly string[]): void {
    this.focusWindow();
    this.handleLaunchArgs(argv);
  }

  private registerAppEvents() {
    app.on("ready", () => {
      this.menuManager.create();
      this.windowManager.create();
      this.setupDockIcon();
      this.registerDevShortcuts();
      this.registerDevToolsListeners();
      this.processPendingExternalOpenPaths();
    });

    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") {
        app.quit();
      }
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.windowManager.create();
        this.registerDevShortcuts();
        this.registerDevToolsListeners();
      }
      this.processPendingExternalOpenPaths();
    });

    app.on("open-file", (event, filePath) => {
      event.preventDefault();
      this.enqueueExternalOpenPath(filePath);
    });

    app.on("before-quit", async (event) => {
      if (this.isQuitting) {
        return;
      }

      event.preventDefault();

      const shouldQuit = await this.documentState.confirmClose();
      if (shouldQuit) {
        this.isQuitting = true;
        this.windowManager.setQuitting(true);
        this.documentState.stopAutosave();
        app.quit();
      }
    });

    app.on("will-quit", () => {
      globalShortcut.unregisterAll();
    });
  }

  private setupDockIcon() {
    if (process.platform === "darwin") {
      const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, "icon.png")
        : path.join(app.getAppPath(), "../../icons/icon.png");
      app.dock?.setIcon(iconPath);
    }
  }

  private registerDevShortcuts() {
    const window = this.windowManager.getWindow();
    if (!window) return;

    window.webContents.once("did-finish-load", () => {
      globalShortcut.register(
        process.platform === "darwin" ? "Command+Shift+R" : "Control+Shift+R",
        () => {
          const win = this.windowManager.getWindow();
          if (win?.isFocused()) {
            win.reload();
          }
        },
      );
    });
  }

  private registerDevToolsListeners() {
    const window = this.windowManager.getWindow();
    if (!window) return;

    window.webContents.on("devtools-opened", () => {
      ipc.send(window.webContents, "devtools-toggled");
    });

    window.webContents.on("devtools-closed", () => {
      ipc.send(window.webContents, "devtools-toggled");
    });
  }

  private focusWindow(): void {
    const window = this.windowManager.getWindow();
    if (!window) return;
    if (window.isMinimized()) {
      window.restore();
    }
    window.focus();
  }

  private enqueueExternalOpenPath(filePath: string): void {
    const normalizedPath = normalizeFontPath(filePath);
    if (!normalizedPath) return;
    this.pendingExternalOpenPaths.push(normalizedPath);
    this.processPendingExternalOpenPaths();
  }

  private processPendingExternalOpenPaths(): void {
    if (this.processingExternalOpenPath) return;
    if (this.pendingExternalOpenPaths.length === 0) return;
    if (!app.isReady()) return;

    let window = this.windowManager.getWindow();
    if (!window) {
      window = this.windowManager.create();
      this.registerDevShortcuts();
      this.registerDevToolsListeners();
    }
    if (!window) return;

    if (window.webContents.isLoadingMainFrame()) {
      window.webContents.once("did-finish-load", () => this.processPendingExternalOpenPaths());
      return;
    }

    const filePath = this.pendingExternalOpenPaths.shift();
    if (!filePath) return;

    this.processingExternalOpenPath = true;
    void this.openExternalFont(filePath)
      .catch((error) => {
        console.error("Failed to open external font:", error);
      })
      .finally(() => {
        this.processingExternalOpenPath = false;
        this.processPendingExternalOpenPaths();
      });
  }

  private async openExternalFont(filePath: string): Promise<void> {
    const window = this.windowManager.getWindow();
    if (!window) {
      this.pendingExternalOpenPaths.unshift(filePath);
      return;
    }

    this.focusWindow();

    if (this.documentState.isDirty()) {
      const shouldOpen = await this.documentState.confirmClose();
      if (!shouldOpen) return;
    }

    this.documentState.setFilePath(filePath);
    ipc.send(window.webContents, "external:open-font", filePath);
  }

  private registerIpcHandlers() {
    ipc.handle(ipcMain, "theme:get", () => this.menuManager.getTheme());

    ipc.handle(ipcMain, "theme:set", (_event, theme) => {
      this.menuManager.setTheme(theme);
    });

    ipc.handle(ipcMain, "debug:getState", () => this.menuManager.getDebugState());

    ipc.handle(ipcMain, "dialog:openFont", async () => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "Fonts", extensions: ["ttf", "otf", "ufo"] }],
      });
      if (!result.canceled && result.filePaths[0]) {
        this.documentState.setFilePath(result.filePaths[0]);
        return result.filePaths[0];
      }
      return null;
    });
  }
}
