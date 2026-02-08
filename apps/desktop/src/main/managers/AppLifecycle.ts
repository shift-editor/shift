import { app, BrowserWindow, globalShortcut, ipcMain, dialog } from "electron";
import path from "node:path";
import type { DocumentState } from "./DocumentState";
import type { WindowManager } from "./WindowManager";
import type { MenuManager } from "./MenuManager";
import * as ipc from "../../shared/ipc/main";

export class AppLifecycle {
  private documentState: DocumentState;
  private windowManager: WindowManager;
  private menuManager: MenuManager;
  private isQuitting = false;

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

  private registerAppEvents() {
    app.on("ready", () => {
      this.menuManager.create();
      this.windowManager.create();
      this.setupDockIcon();
      this.registerDevShortcuts();
      this.registerDevToolsListeners();
    });

    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") {
        app.quit();
      }
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.windowManager.create();
      }
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
