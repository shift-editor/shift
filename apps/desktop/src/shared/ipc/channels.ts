import type { ThemeName, DebugState, DebugOverlays } from "./types";

/** Main -> Renderer broadcasts (webContents.send / ipcRenderer.on) */
export type IpcEvents = {
  "menu:open-font": (path: string) => void;
  "external:open-font": (path: string) => void;
  "menu:save-font": (path: string) => void;
  "menu:undo": () => void;
  "menu:redo": () => void;
  "menu:delete": () => void;
  "menu:select-all": () => void;
  "theme:set": (theme: ThemeName) => void;
  "ui:zoom-changed": (zoomPercent: number) => void;
  "devtools-toggled": () => void;
  "debug:react-scan": (enabled: boolean) => void;
  "debug:panel": (open: boolean) => void;
  "debug:dump-snapshot": () => void;
  "debug:overlays": (overlays: DebugOverlays) => void;
};

/** Renderer -> Main request/response (ipcRenderer.invoke / ipcMain.handle) */
export type IpcCommands = {
  "dialog:openFont": () => string | null;
  "theme:get": () => ThemeName;
  "theme:set": (theme: ThemeName) => void;
  "debug:getState": () => DebugState;
  "window:close": () => void;
  "window:minimize": () => void;
  "window:maximize": () => void;
  "window:isMaximized": () => boolean;
  "document:setDirty": (dirty: boolean) => void;
  "document:setFilePath": (filePath: string | null) => void;
  "document:saveCompleted": (filePath: string) => void;
  "fs:pathsExist": (paths: string[]) => boolean[];
};
