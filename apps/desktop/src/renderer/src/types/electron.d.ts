/**
 * Type declarations for the Electron preload API
 *
 * Note: FontEngineAPI types are defined in @shared/bridge/FontEngineAPI.ts
 * which is the single source of truth for the preload bridge types.
 */

export type ThemeName = "light" | "dark" | "system";

export interface ElectronAPI {
  onMenuOpenFont: (callback: (path: string) => void) => () => void;
  onMenuSaveFont: (callback: (path: string) => void) => () => void;
  onMenuUndo: (callback: () => void) => () => void;
  onMenuRedo: (callback: () => void) => () => void;
  onMenuDelete: (callback: () => void) => () => void;
  onSetTheme: (callback: (theme: ThemeName) => void) => () => void;
  getTheme: () => Promise<ThemeName>;
  setTheme: (theme: ThemeName) => Promise<void>;

  closeWindow: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;

  setDocumentDirty: (dirty: boolean) => Promise<void>;
  setDocumentFilePath: (filePath: string | null) => Promise<void>;
  saveCompleted: (filePath: string) => Promise<void>;

  clipboardReadText: () => string;
  clipboardWriteText: (text: string) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
