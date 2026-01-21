/**
 * Type declarations for the Electron preload API
 *
 * This file declares the window.shiftFont interface that's exposed
 * via Electron's contextBridge in preload.ts
 */

import type {
  FontMetadata,
  FontMetrics,
  GlyphSnapshot,
  CommandResult,
} from "./snapshots";

// ═══════════════════════════════════════════════════════════
// NATIVE SNAPSHOT TYPES (returned by getSnapshotData)
// ═══════════════════════════════════════════════════════════

export interface NativePointSnapshot {
  id: string;
  x: number;
  y: number;
  pointType: string;
  smooth: boolean;
}

export interface NativeContourSnapshot {
  id: string;
  points: NativePointSnapshot[];
  closed: boolean;
}

export interface NativeGlyphSnapshot {
  unicode: number;
  name: string;
  xAdvance: number;
  contours: NativeContourSnapshot[];
  activeContourId: string | null;
}

// ═══════════════════════════════════════════════════════════
// FONT ENGINE API
// ═══════════════════════════════════════════════════════════

/**
 * The native FontEngine API exposed via contextBridge.
 * This matches the Rust FontEngine NAPI exports.
 */
export interface NativeFontEngine {
  // ─────────────────────────────────────────────────────────
  // Font Loading & Saving
  // ─────────────────────────────────────────────────────────

  /** Load a font file from the given path */
  loadFont(path: string): void;

  /** Save the font to the given path */
  saveFont(path: string): void;

  // ─────────────────────────────────────────────────────────
  // Font Info
  // ─────────────────────────────────────────────────────────

  /** Get font metadata (family, style, version) */
  getMetadata(): FontMetadata;

  /** Get font metrics (upm, ascender, descender, etc.) */
  getMetrics(): FontMetrics;

  /** Get the number of glyphs in the font */
  getGlyphCount(): number;

  // ─────────────────────────────────────────────────────────
  // Edit Session
  // ─────────────────────────────────────────────────────────

  /** Start an edit session for a glyph by unicode codepoint */
  startEditSession(unicode: number): void;

  /** End the current edit session */
  endEditSession(): void;

  /** Check if an edit session is active */
  hasEditSession(): boolean;

  /** Get the unicode of the glyph being edited (or null) */
  getEditingUnicode(): number | null;

  // ─────────────────────────────────────────────────────────
  // Snapshots
  // ─────────────────────────────────────────────────────────

  /**
   * Get the current glyph snapshot as a JSON string.
   * Returns null if no edit session is active.
   * Use JSON.parse() to convert to GlyphSnapshot.
   */
  getSnapshot(): string | null;

  /**
   * Get the current glyph snapshot as a native object.
   * More efficient than getSnapshot() + JSON.parse().
   * Throws if no edit session is active.
   */
  getSnapshotData(): NativeGlyphSnapshot;

  // ─────────────────────────────────────────────────────────
  // Contour Operations
  // ─────────────────────────────────────────────────────────

  /**
   * Add an empty contour and set it as active.
   * Returns the contour ID as a string.
   */
  addEmptyContour(): string;

  /**
   * Add an empty contour and return a CommandResult JSON string.
   */
  addContour(): string;

  /**
   * Get the active contour ID (or null if none).
   */
  getActiveContourId(): string | null;

  /**
   * Close the active contour.
   * Returns a CommandResult JSON string.
   */
  closeContour(): string;

  // ─────────────────────────────────────────────────────────
  // Point Operations
  // ─────────────────────────────────────────────────────────

  /**
   * Add a point to the active contour.
   * Returns a CommandResult JSON string.
   */
  addPoint(
    x: number,
    y: number,
    pointType: "onCurve" | "offCurve",
    smooth: boolean,
  ): string;

  /**
   * Add a point to a specific contour.
   * Returns a CommandResult JSON string.
   */
  addPointToContour(
    contourId: string,
    x: number,
    y: number,
    pointType: "onCurve" | "offCurve",
    smooth: boolean,
  ): string;

  /**
   * Move multiple points by a delta.
   * Returns a CommandResult JSON string with affected point IDs.
   */
  movePoints(pointIds: string[], dx: number, dy: number): string;

  /**
   * Remove multiple points by their IDs.
   * Returns a CommandResult JSON string.
   */
  removePoints(pointIds: string[]): string;
}

// ═══════════════════════════════════════════════════════════
// ELECTRON IPC API
// ═══════════════════════════════════════════════════════════

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

  // Window controls
  closeWindow: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;

  // Document state
  setDocumentDirty: (dirty: boolean) => Promise<void>;
  setDocumentFilePath: (filePath: string | null) => Promise<void>;
  saveCompleted: (filePath: string) => Promise<void>;
}

// ═══════════════════════════════════════════════════════════
// GLOBAL TYPE DECLARATIONS
// ═══════════════════════════════════════════════════════════

declare global {
  interface Window {
    /**
     * The Rust FontEngine exposed via Electron's contextBridge.
     * Available after the preload script runs.
     */
    shiftFont: NativeFontEngine;

    /**
     * Electron IPC API exposed via contextBridge.
     * Available after the preload script runs.
     */
    electronAPI?: ElectronAPI;
  }
}

export {};
