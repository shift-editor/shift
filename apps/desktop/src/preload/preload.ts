// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer, clipboard } = require("electron");
const { FontEngine } = require("shift-node");
import { ContourId } from "@shift/types";
import type { FontEngineAPI } from "../shared/bridge/FontEngineAPI";

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

type ThemeName = "light" | "dark" | "system";

const electronAPI = {
  openFontDialog: (): Promise<string | null> => ipcRenderer.invoke("dialog:openFont"),
  onMenuOpenFont: (callback: (path: string) => void) => {
    const handler = (_event: any, path: string) => callback(path);
    ipcRenderer.on("menu:open-font", handler);
    return () => ipcRenderer.removeListener("menu:open-font", handler);
  },
  onMenuSaveFont: (callback: (path: string) => void) => {
    const handler = (_event: any, path: string) => callback(path);
    ipcRenderer.on("menu:save-font", handler);
    return () => ipcRenderer.removeListener("menu:save-font", handler);
  },
  onMenuUndo: (callback: () => void) => {
    ipcRenderer.on("menu:undo", callback);
    return () => ipcRenderer.removeListener("menu:undo", callback);
  },
  onMenuRedo: (callback: () => void) => {
    ipcRenderer.on("menu:redo", callback);
    return () => ipcRenderer.removeListener("menu:redo", callback);
  },
  onMenuDelete: (callback: () => void) => {
    ipcRenderer.on("menu:delete", callback);
    return () => ipcRenderer.removeListener("menu:delete", callback);
  },
  onSetTheme: (callback: (theme: ThemeName) => void) => {
    const handler = (_event: any, theme: ThemeName) => callback(theme);
    ipcRenderer.on("theme:set", handler);
    return () => ipcRenderer.removeListener("theme:set", handler);
  },
  getTheme: (): Promise<ThemeName> => ipcRenderer.invoke("theme:get"),
  setTheme: (theme: ThemeName): Promise<void> => ipcRenderer.invoke("theme:set", theme),

  // UI Zoom
  onUiZoomChanged: (callback: (zoomPercent: number) => void) => {
    const handler = (_event: any, zoomPercent: number) => callback(zoomPercent);
    ipcRenderer.on("ui:zoom-changed", handler);
    return () => ipcRenderer.removeListener("ui:zoom-changed", handler);
  },

  // DevTools toggle
  onDevToolsToggled: (callback: () => void) => {
    ipcRenderer.on("devtools-toggled", callback);
    return () => ipcRenderer.removeListener("devtools-toggled", callback);
  },

  // Window controls
  closeWindow: (): Promise<void> => ipcRenderer.invoke("window:close"),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  maximizeWindow: (): Promise<void> => ipcRenderer.invoke("window:maximize"),
  isWindowMaximized: (): Promise<boolean> => ipcRenderer.invoke("window:isMaximized"),

  // Document state
  setDocumentDirty: (dirty: boolean): Promise<void> =>
    ipcRenderer.invoke("document:setDirty", dirty),
  setDocumentFilePath: (filePath: string | null): Promise<void> =>
    ipcRenderer.invoke("document:setFilePath", filePath),
  saveCompleted: (filePath: string): Promise<void> =>
    ipcRenderer.invoke("document:saveCompleted", filePath),

  // Clipboard
  clipboardReadText: (): string => clipboard.readText(),
  clipboardWriteText: (text: string): void => clipboard.writeText(text),

  // Debug
  onDebugReactScan: (callback: (enabled: boolean) => void) => {
    const handler = (_event: any, enabled: boolean) => callback(enabled);
    ipcRenderer.on("debug:react-scan", handler);
    return () => ipcRenderer.removeListener("debug:react-scan", handler);
  },
  onDebugPanel: (callback: (open: boolean) => void) => {
    const handler = (_event: any, open: boolean) => callback(open);
    ipcRenderer.on("debug:panel", handler);
    return () => ipcRenderer.removeListener("debug:panel", handler);
  },
  onDebugDumpSnapshot: (callback: () => void) => {
    ipcRenderer.on("debug:dump-snapshot", callback);
    return () => ipcRenderer.removeListener("debug:dump-snapshot", callback);
  },
  onDebugOverlays: (
    callback: (overlays: {
      tightBounds: boolean;
      hitRadii: boolean;
      segmentBounds: boolean;
    }) => void,
  ) => {
    const handler = (
      _event: any,
      overlays: { tightBounds: boolean; hitRadii: boolean; segmentBounds: boolean },
    ) => callback(overlays);
    ipcRenderer.on("debug:overlays", handler);
    return () => ipcRenderer.removeListener("debug:overlays", handler);
  },
  getDebugState: (): Promise<{
    reactScanEnabled: boolean;
    debugPanelOpen: boolean;
    overlays: { tightBounds: boolean; hitRadii: boolean; segmentBounds: boolean };
  }> => ipcRenderer.invoke("debug:getState"),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
