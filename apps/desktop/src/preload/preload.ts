// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer, clipboard } = require("electron");
const { FontEngine } = require("shift-node");
import type { FontEngineAPI } from "../shared/bridge/FontEngineAPI";
import type { IpcEvents, IpcCommands } from "../shared/ipc/channels";
import type { ElectronAPI } from "../shared/ipc/electronAPI";
import { listener, command } from "../shared/ipc/preload";

const fontEngineInstance = new FontEngine();

function buildFontEngineAPI(instance: InstanceType<typeof FontEngine>): FontEngineAPI {
  const api: Record<string, unknown> = {};
  const proto = Object.getPrototypeOf(instance);
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === "constructor" || typeof instance[name] !== "function") continue;
    api[name] = (...args: unknown[]) => instance[name](...args);
  }
  return api as unknown as FontEngineAPI;
}

const fontEngineAPI = buildFontEngineAPI(fontEngineInstance);

// Expose to renderer via contextBridge
contextBridge.exposeInMainWorld("shiftFont", fontEngineAPI);

const on = <K extends keyof IpcEvents>(ch: K) => listener(ipcRenderer, ch);
const invoke = <K extends keyof IpcCommands>(ch: K) => command(ipcRenderer, ch);

const electronAPI: ElectronAPI = {
  // Commands
  openFontDialog: invoke("dialog:openFont"),
  getTheme: invoke("theme:get"),
  setTheme: invoke("theme:set"),
  closeWindow: invoke("window:close"),
  minimizeWindow: invoke("window:minimize"),
  maximizeWindow: invoke("window:maximize"),
  isWindowMaximized: invoke("window:isMaximized"),
  setDocumentDirty: invoke("document:setDirty"),
  setDocumentFilePath: invoke("document:setFilePath"),
  saveCompleted: invoke("document:saveCompleted"),
  getDebugState: invoke("debug:getState"),

  // Events
  onMenuOpenFont: on("menu:open-font"),
  onMenuSaveFont: on("menu:save-font"),
  onMenuUndo: on("menu:undo"),
  onMenuRedo: on("menu:redo"),
  onMenuDelete: on("menu:delete"),
  onMenuSelectAll: on("menu:select-all"),
  onSetTheme: on("theme:set"),
  onUiZoomChanged: on("ui:zoom-changed"),
  onDevToolsToggled: on("devtools-toggled"),
  onDebugReactScan: on("debug:react-scan"),
  onDebugPanel: on("debug:panel"),
  onDebugDumpSnapshot: on("debug:dump-snapshot"),
  onDebugOverlays: on("debug:overlays"),

  // Clipboard (direct, no IPC)
  clipboardReadText: (): string => clipboard.readText(),
  clipboardWriteText: (text: string): void => clipboard.writeText(text),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
