import { app, BrowserWindow, globalShortcut, ipcMain, dialog } from "electron";
import path from "node:path";
import type { DocumentState } from "./DocumentState";
import type { WindowManager } from "./WindowManager";
import type { MenuManager } from "./MenuManager";

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

  private registerIpcHandlers() {
    ipcMain.handle("theme:get", () => this.menuManager.getTheme());

    ipcMain.handle("theme:set", (_event, theme: "light" | "dark" | "system") => {
      this.menuManager.setTheme(theme);
    });

    ipcMain.handle("dialog:openFont", async () => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile", "openDirectory"],
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
