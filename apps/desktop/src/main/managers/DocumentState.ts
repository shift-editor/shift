import { dialog, BrowserWindow } from "electron";
import path from "node:path";

const AUTOSAVE_INTERVAL_MS = 30_000;

export class DocumentState {
  private dirty = false;
  private filePath: string | null = null;
  private autosaveIntervalId: ReturnType<typeof setInterval> | null = null;
  private window: BrowserWindow | null = null;
  private onTitleUpdate: (() => void) | null = null;

  setWindow(window: BrowserWindow | null) {
    this.window = window;
  }

  setOnTitleUpdate(callback: () => void) {
    this.onTitleUpdate = callback;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  getFilePath(): string | null {
    return this.filePath;
  }

  getFileName(): string {
    return this.filePath ? path.basename(this.filePath) : "Untitled";
  }

  setDirty(dirty: boolean) {
    this.dirty = dirty;
    this.onTitleUpdate?.();
  }

  setFilePath(filePath: string | null) {
    this.filePath = filePath;
    this.onTitleUpdate?.();
  }

  private isWritableFormat(filePath: string | null): boolean {
    if (!filePath) return false;
    return filePath.endsWith(".ufo");
  }

  async save(saveAs = false): Promise<boolean> {
    if (this.filePath && !this.isWritableFormat(this.filePath) && !saveAs) {
      return false;
    }

    let savePath = this.filePath;

    if (!savePath || saveAs || !this.isWritableFormat(savePath)) {
      let defaultPath = "Untitled.ufo";
      if (this.filePath) {
        const baseName = path.basename(this.filePath, path.extname(this.filePath));
        defaultPath = `${baseName}.ufo`;
      }

      const result = await dialog.showSaveDialog({
        defaultPath,
        filters: [{ name: "UFO Files", extensions: ["ufo"] }],
      });

      if (result.canceled || !result.filePath) {
        return false;
      }

      savePath = result.filePath;
      if (!savePath.endsWith(".ufo")) {
        savePath += ".ufo";
      }
    }

    this.window?.webContents.send("menu:save-font", savePath);
    return true;
  }

  async confirmClose(): Promise<boolean> {
    if (!this.dirty) {
      return true;
    }

    if (!this.window) {
      return true;
    }

    const fileName = this.getFileName();

    const { response } = await dialog.showMessageBox(this.window, {
      type: "question",
      buttons: ["Don't Save", "Cancel", "Save"],
      defaultId: 2,
      cancelId: 1,
      message: `Do you want to save changes to "${fileName}"?`,
      detail: "Your changes will be lost if you don't save.",
    });

    if (response === 1) {
      return false;
    }

    if (response === 2) {
      const saved = await this.save(false);
      if (!saved) {
        return false;
      }
    }

    return true;
  }

  onSaveCompleted(filePath: string) {
    this.setFilePath(filePath);
    this.setDirty(false);
  }

  startAutosave() {
    if (this.autosaveIntervalId) return;

    this.autosaveIntervalId = setInterval(() => {
      if (this.dirty && this.filePath && this.isWritableFormat(this.filePath)) {
        this.save(false);
      }
    }, AUTOSAVE_INTERVAL_MS);
  }

  stopAutosave() {
    if (this.autosaveIntervalId) {
      clearInterval(this.autosaveIntervalId);
      this.autosaveIntervalId = null;
    }
  }

  reset() {
    this.dirty = false;
    this.filePath = null;
    this.stopAutosave();
  }
}
