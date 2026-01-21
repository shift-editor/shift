// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require("electron");
const { FontEngine } = require("shift-node");
import type { FontEngineAPI } from "../shared/bridge/FontEngineAPI";

// Create a single FontEngine instance
const fontEngineInstance = new FontEngine();

// Expose the full FontEngine API via contextBridge
const fontEngineAPI = {
  // ═══════════════════════════════════════════════════════════
  // FONT LOADING
  // ═══════════════════════════════════════════════════════════

  loadFont: (path: string) => {
    return fontEngineInstance.loadFont(path);
  },

  saveFont: (path: string) => {
    return fontEngineInstance.saveFont(path);
  },

  // ═══════════════════════════════════════════════════════════
  // FONT INFO
  // ═══════════════════════════════════════════════════════════

  getMetadata: () => {
    return fontEngineInstance.getMetadata();
  },

  getMetrics: () => {
    return fontEngineInstance.getMetrics();
  },

  getGlyphCount: (): number => {
    return fontEngineInstance.getGlyphCount();
  },

  // ═══════════════════════════════════════════════════════════
  // EDIT SESSION
  // ═══════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════
  // SNAPSHOT METHODS
  // ═══════════════════════════════════════════════════════════

  /**
   * Get the current glyph snapshot as a JSON string.
   * Returns null if no edit session is active.
   */
  getSnapshot: (): string | null => {
    return fontEngineInstance.getSnapshot() ?? null;
  },

  /**
   * Get the current glyph snapshot as a native object (more efficient).
   * Throws if no edit session is active.
   */
  getSnapshotData: () => {
    return fontEngineInstance.getSnapshotData();
  },

  // ═══════════════════════════════════════════════════════════
  // CONTOUR OPERATIONS
  // ═══════════════════════════════════════════════════════════

  /**
   * Add an empty contour (legacy method, returns contour ID string).
   */
  addEmptyContour: (): string => {
    return fontEngineInstance.addEmptyContour();
  },

  /**
   * Add a contour and return CommandResult JSON.
   */
  addContour: (): string => {
    return fontEngineInstance.addContour();
  },

  /**
   * Get the active contour ID (or null).
   */
  getActiveContourId: (): string | null => {
    return fontEngineInstance.getActiveContourId() ?? null;
  },

  /**
   * Close the active contour.
   * Returns CommandResult JSON.
   */
  closeContour: (): string => {
    return fontEngineInstance.closeContour();
  },

  /**
   * Set the active contour by ID.
   * Returns CommandResult JSON.
   */
  setActiveContour: (contourId: string): string => {
    return fontEngineInstance.setActiveContour(contourId);
  },

  /**
   * Reverse the points in a contour.
   * Returns CommandResult JSON.
   */
  reverseContour: (contourId: string): string => {
    return fontEngineInstance.reverseContour(contourId);
  },

  // ═══════════════════════════════════════════════════════════
  // POINT OPERATIONS
  // ═══════════════════════════════════════════════════════════

  /**
   * Add a point to the active contour.
   * Returns CommandResult JSON.
   */
  addPoint: (
    x: number,
    y: number,
    pointType: "onCurve" | "offCurve",
    smooth: boolean,
  ): string => {
    return fontEngineInstance.addPoint(x, y, pointType, smooth);
  },

  /**
   * Add a point to a specific contour.
   * Returns CommandResult JSON.
   */
  addPointToContour: (
    contourId: string,
    x: number,
    y: number,
    pointType: "onCurve" | "offCurve",
    smooth: boolean,
  ): string => {
    return fontEngineInstance.addPointToContour(
      contourId,
      x,
      y,
      pointType,
      smooth,
    );
  },

  /**
   * Move multiple points by a delta.
   * Returns CommandResult JSON with affected point IDs.
   */
  movePoints: (pointIds: string[], dx: number, dy: number): string => {
    return fontEngineInstance.movePoints(pointIds, dx, dy);
  },

  /**
   * Remove multiple points by their IDs.
   * Returns CommandResult JSON.
   */
  removePoints: (pointIds: string[]): string => {
    return fontEngineInstance.removePoints(pointIds);
  },

  /**
   * Insert a point before an existing point.
   * Returns CommandResult JSON.
   */
  insertPointBefore: (
    beforePointId: string,
    x: number,
    y: number,
    pointType: "onCurve" | "offCurve",
    smooth: boolean,
  ): string => {
    return fontEngineInstance.insertPointBefore(
      beforePointId,
      x,
      y,
      pointType,
      smooth,
    );
  },

  /**
   * Toggle the smooth property of a point.
   * Returns CommandResult JSON.
   */
  toggleSmooth: (pointId: string): string => {
    return fontEngineInstance.toggleSmooth(pointId);
  },

  // ═══════════════════════════════════════════════════════════
  // UNIFIED EDIT OPERATION
  // ═══════════════════════════════════════════════════════════

  /**
   * Apply edits to selected points with automatic rule matching and application.
   * Combines: move points → match rules → apply rules (handle movement, tangency).
   * Returns JSON with { success, snapshot, affectedPointIds, matchedRules, error }.
   */
  applyEditsUnified: (pointIds: string[], dx: number, dy: number): string => {
    return fontEngineInstance.applyEditsUnified(pointIds, dx, dy);
  },
} satisfies FontEngineAPI;

// Expose to renderer via contextBridge
contextBridge.exposeInMainWorld("shiftFont", fontEngineAPI);

type ThemeName = "light" | "dark" | "system";

const electronAPI = {
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
  setTheme: (theme: ThemeName): Promise<void> =>
    ipcRenderer.invoke("theme:set", theme),

  // Window controls
  closeWindow: (): Promise<void> => ipcRenderer.invoke("window:close"),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  maximizeWindow: (): Promise<void> => ipcRenderer.invoke("window:maximize"),
  isWindowMaximized: (): Promise<boolean> =>
    ipcRenderer.invoke("window:isMaximized"),

  // Document state
  setDocumentDirty: (dirty: boolean): Promise<void> =>
    ipcRenderer.invoke("document:setDirty", dirty),
  setDocumentFilePath: (filePath: string | null): Promise<void> =>
    ipcRenderer.invoke("document:setFilePath", filePath),
  saveCompleted: (filePath: string): Promise<void> =>
    ipcRenderer.invoke("document:saveCompleted", filePath),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
