import type { ElectronAPI } from "@shared/ipc/electronAPI";

export type { ThemeName, DebugOverlays, DebugState } from "@shared/ipc/types";
export type { ElectronAPI } from "@shared/ipc/electronAPI";

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
