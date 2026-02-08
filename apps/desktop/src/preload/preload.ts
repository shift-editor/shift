// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer, clipboard } = require("electron");
const { FontEngine } = require("shift-node");
import { ContourId } from "@shift/types";
import type { FontEngineAPI } from "../shared/bridge/FontEngineAPI";
import type { IpcEvents, IpcCommands } from "../shared/ipc/channels";
import type { ElectronAPI } from "../shared/ipc/electronAPI";
import { listener, command } from "../shared/ipc/preload";

const fontEngineInstance = new FontEngine();

const fontEngineAPI = {
  loadFont: (path: string) => {
    return fontEngineInstance.loadFont(path);
  },

  saveFont: (path: string) => {
    return fontEngineInstance.saveFont(path);
  },

  saveFontAsync: (path: string): Promise<void> => {
    return fontEngineInstance.saveFontAsync(path);
  },

  getMetadata: () => {
    return fontEngineInstance.getMetadata();
  },

  getMetrics: () => {
    return fontEngineInstance.getMetrics();
  },

  getGlyphCount: (): number => {
    return fontEngineInstance.getGlyphCount();
  },

  getGlyphUnicodes: (): number[] => {
    return fontEngineInstance.getGlyphUnicodes();
  },

  getGlyphSvgPath: (unicode: number): string | null => {
    return fontEngineInstance.getGlyphSvgPath(unicode) ?? null;
  },

  getGlyphAdvance: (unicode: number): number | null => {
    return fontEngineInstance.getGlyphAdvance(unicode) ?? null;
  },

  getGlyphBbox: (unicode: number): [number, number, number, number] | null => {
    return fontEngineInstance.getGlyphBbox(unicode) ?? null;
  },

  startEditSession: (unicode: number) => {
    return fontEngineInstance.startEditSession(unicode);
  },

  endEditSession: () => {
    return fontEngineInstance.endEditSession();
  },

  hasEditSession: (): boolean => {
    return fontEngineInstance.hasEditSession();
  },

  getEditingUnicode: (): number | null => {
    return fontEngineInstance.getEditingUnicode() ?? null;
  },

  getSnapshotData: () => {
    return fontEngineInstance.getSnapshotData();
  },

  addEmptyContour: (): string => {
    return fontEngineInstance.addEmptyContour();
  },

  addContour: (): string => {
    return fontEngineInstance.addContour();
  },

  getActiveContourId: (): ContourId | null => {
    return fontEngineInstance.getActiveContourId() ?? null;
  },

  closeContour: (): string => {
    return fontEngineInstance.closeContour();
  },

  setActiveContour: (contourId: string): string => {
    return fontEngineInstance.setActiveContour(contourId);
  },

  clearActiveContour: (): string => {
    return fontEngineInstance.clearActiveContour();
  },

  reverseContour: (contourId: string): string => {
    return fontEngineInstance.reverseContour(contourId);
  },

  removeContour: (contourId: string): string => {
    return fontEngineInstance.removeContour(contourId);
  },

  openContour: (contourId: string): string => {
    return fontEngineInstance.openContour(contourId);
  },

  addPoint: (x: number, y: number, pointType: "onCurve" | "offCurve", smooth: boolean): string => {
    return fontEngineInstance.addPoint(x, y, pointType, smooth);
  },

  addPointToContour: (
    contourId: string,
    x: number,
    y: number,
    pointType: "onCurve" | "offCurve",
    smooth: boolean,
  ): string => {
    return fontEngineInstance.addPointToContour(contourId, x, y, pointType, smooth);
  },

  movePoints: (pointIds: string[], dx: number, dy: number): string => {
    return fontEngineInstance.movePoints(pointIds, dx, dy);
  },

  removePoints: (pointIds: string[]): string => {
    return fontEngineInstance.removePoints(pointIds);
  },

  insertPointBefore: (
    beforePointId: string,
    x: number,
    y: number,
    pointType: "onCurve" | "offCurve",
    smooth: boolean,
  ): string => {
    return fontEngineInstance.insertPointBefore(beforePointId, x, y, pointType, smooth);
  },

  toggleSmooth: (pointId: string): string => {
    return fontEngineInstance.toggleSmooth(pointId);
  },

  pasteContours: (contoursJson: string, offsetX: number, offsetY: number): string => {
    return fontEngineInstance.pasteContours(contoursJson, offsetX, offsetY);
  },

  setPointPositions: (moves: Array<{ id: string; x: number; y: number }>): boolean => {
    return fontEngineInstance.setPointPositions(moves);
  },

  restoreSnapshot: (snapshotJson: string): boolean => {
    return fontEngineInstance.restoreSnapshot(snapshotJson);
  },
} satisfies FontEngineAPI;

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
