import type { IpcEvents, IpcCommands } from "./channels";

/** A listener created by the preload `on()` helper */
type EventListener<K extends keyof IpcEvents> = (
  callback: (...args: Parameters<IpcEvents[K]>) => void,
) => () => void;

/** A command created by the preload `invoke()` helper */
type CommandInvoker<K extends keyof IpcCommands> = (
  ...args: Parameters<IpcCommands[K]>
) => Promise<ReturnType<IpcCommands[K]>>;

/**
 * Typed API exposed to the renderer via contextBridge.
 * Derived from the IpcEvents/IpcCommands channel maps — this is the single source of truth.
 */
export interface ElectronAPI {
  // Commands
  openFontDialog: CommandInvoker<"dialog:openFont">;
  getTheme: CommandInvoker<"theme:get">;
  setTheme: CommandInvoker<"theme:set">;
  closeWindow: CommandInvoker<"window:close">;
  minimizeWindow: CommandInvoker<"window:minimize">;
  maximizeWindow: CommandInvoker<"window:maximize">;
  isWindowMaximized: CommandInvoker<"window:isMaximized">;
  setDocumentDirty: CommandInvoker<"document:setDirty">;
  setDocumentFilePath: CommandInvoker<"document:setFilePath">;
  saveCompleted: CommandInvoker<"document:saveCompleted">;
  getDebugState: CommandInvoker<"debug:getState">;

  // Events
  onMenuOpenFont: EventListener<"menu:open-font">;
  onExternalOpenFont: EventListener<"external:open-font">;
  onMenuSaveFont: EventListener<"menu:save-font">;
  onMenuUndo: EventListener<"menu:undo">;
  onMenuRedo: EventListener<"menu:redo">;
  onMenuDelete: EventListener<"menu:delete">;
  onMenuSelectAll: EventListener<"menu:select-all">;
  onSetTheme: EventListener<"theme:set">;
  onUiZoomChanged: EventListener<"ui:zoom-changed">;
  onDevToolsToggled: EventListener<"devtools-toggled">;
  onDebugReactScan: EventListener<"debug:react-scan">;
  onDebugPanel: EventListener<"debug:panel">;
  onDebugDumpSnapshot: EventListener<"debug:dump-snapshot">;
  onDebugOverlays: EventListener<"debug:overlays">;

  // System
  homePath: string;

  // Clipboard (direct, no IPC)
  clipboardReadText: () => string;
  clipboardWriteText: (text: string) => void;
}
