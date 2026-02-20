import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import type { DocumentState } from "./DocumentState";
import * as ipc from "../../shared/ipc/main";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;

export class WindowManager {
  private window: BrowserWindow | null = null;
  private documentState: DocumentState;
  private isQuitting = false;

  constructor(documentState: DocumentState) {
    this.documentState = documentState;
    this.registerIpcHandlers();
  }

  setQuitting(quitting: boolean) {
    this.isQuitting = quitting;
  }

  getWindow(): BrowserWindow | null {
    return this.window;
  }

  create() {
    this.window = new BrowserWindow({
      width: 800,
      height: 600,
      title: "Shift",
      titleBarStyle: "hidden",
      trafficLightPosition: { x: -100, y: -100 },
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        sandbox: false,
      },
    });

    this.window.maximize();
    this.updateTitle();
    this.documentState.setWindow(this.window);
    this.documentState.setOnTitleUpdate(() => this.updateTitle());
    this.documentState.startAutosave();

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      this.window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
      this.window.loadFile(path.join(__dirname, `../renderer/index.html`));
    }

    this.window.on("close", async (event) => {
      if (this.isQuitting) {
        this.documentState.stopAutosave();
        return;
      }

      if (!this.documentState.isDirty()) {
        this.documentState.stopAutosave();
        return;
      }

      event.preventDefault();

      const shouldClose = await this.documentState.confirmClose();
      if (shouldClose) {
        this.documentState.stopAutosave();
        this.window?.destroy();
      }
    });

    this.window.on("closed", () => {
      this.window = null;
      this.documentState.setWindow(null);
    });

    return this.window;
  }

  updateTitle() {
    if (!this.window) return;

    const fileName = this.documentState.getFileName();
    const dirty = this.documentState.isDirty();
    const title = this.documentState.getFilePath()
      ? `${fileName}${dirty ? " — Edited" : ""}`
      : `Untitled Font${dirty ? " — Edited" : ""}`;

    this.window.setTitle(title);
    this.window.setDocumentEdited(dirty);
  }

  private registerIpcHandlers() {
    ipc.handle(ipcMain, "window:close", () => {
      this.window?.close();
    });

    ipc.handle(ipcMain, "window:minimize", () => {
      this.window?.minimize();
    });

    ipc.handle(ipcMain, "window:maximize", () => {
      if (this.window?.isMaximized()) {
        this.window.unmaximize();
      } else {
        this.window?.maximize();
      }
    });

    ipc.handle(ipcMain, "window:isMaximized", () => {
      return this.window?.isMaximized() ?? false;
    });

    ipc.handle(ipcMain, "document:setDirty", (_event, dirty) => {
      this.documentState.setDirty(dirty);
    });

    ipc.handle(ipcMain, "document:setFilePath", (_event, filePath) => {
      this.documentState.setFilePath(filePath);
    });

    ipc.handle(ipcMain, "document:saveCompleted", (_event, filePath) => {
      this.documentState.onSaveCompleted(filePath);
    });
  }
}
