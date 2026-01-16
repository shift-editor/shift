/**
 * Typed interface for the native Rust FontEngine exposed via Electron's contextBridge.
 *
 * This interface matches the NAPI bindings in shift-node/src/font_engine.rs
 * and the preload script at src/preload/preload.ts.
 */

import type { PointTypeString } from "@/types/generated";

/**
 * Font metadata returned by the native module.
 */
export interface NativeFontMetadata {
  family: string;
  styleName: string;
  version: number;
}

/**
 * Font metrics returned by the native module.
 */
export interface NativeFontMetrics {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  capHeight: number;
  xHeight: number;
}

/**
 * Point snapshot as returned by getSnapshotData().
 */
export interface NativePointSnapshot {
  id: string;
  x: number;
  y: number;
  pointType: string;
  smooth: boolean;
}

/**
 * Contour snapshot as returned by getSnapshotData().
 */
export interface NativeContourSnapshot {
  id: string;
  points: NativePointSnapshot[];
  closed: boolean;
}

/**
 * Glyph snapshot as returned by getSnapshotData().
 */
export interface NativeGlyphSnapshot {
  unicode: number;
  name: string;
  xAdvance: number;
  contours: NativeContourSnapshot[];
  activeContourId: string | null;
}

/**
 * The native FontEngine API exposed via window.shiftFont.
 */
export interface NativeFontEngine {
  // ═══════════════════════════════════════════════════════════
  // FONT LOADING
  // ═══════════════════════════════════════════════════════════

  loadFont(path: string): void;

  // ═══════════════════════════════════════════════════════════
  // FONT INFO
  // ═══════════════════════════════════════════════════════════

  getMetadata(): NativeFontMetadata;
  getMetrics(): NativeFontMetrics;
  getGlyphCount(): number;

  // ═══════════════════════════════════════════════════════════
  // EDIT SESSION
  // ═══════════════════════════════════════════════════════════

  startEditSession(unicode: number): void;
  endEditSession(): void;
  hasEditSession(): boolean;
  getEditingUnicode(): number | null;

  // ═══════════════════════════════════════════════════════════
  // SNAPSHOT METHODS
  // ═══════════════════════════════════════════════════════════

  /** Get the current glyph snapshot as a JSON string. Returns null if no edit session. */
  getSnapshot(): string | null;

  /** Get the current glyph snapshot as a native object (more efficient). */
  getSnapshotData(): NativeGlyphSnapshot;

  // ═══════════════════════════════════════════════════════════
  // CONTOUR OPERATIONS
  // ═══════════════════════════════════════════════════════════

  /** Add an empty contour (returns contour ID string). */
  addEmptyContour(): string;

  /** Add a contour and return CommandResult JSON. */
  addContour(): string;

  /** Get the active contour ID (or null). */
  getActiveContourId(): string | null;

  /** Close the active contour. Returns CommandResult JSON. */
  closeContour(): string;

  // ═══════════════════════════════════════════════════════════
  // POINT OPERATIONS
  // ═══════════════════════════════════════════════════════════

  /** Add a point to the active contour. Returns CommandResult JSON. */
  addPoint(
    x: number,
    y: number,
    pointType: PointTypeString,
    smooth: boolean
  ): string;

  /** Add a point to a specific contour. Returns CommandResult JSON. */
  addPointToContour(
    contourId: string,
    x: number,
    y: number,
    pointType: PointTypeString,
    smooth: boolean
  ): string;

  /** Move multiple points by a delta. Returns CommandResult JSON. */
  movePoints(pointIds: string[], dx: number, dy: number): string;

  /** Remove multiple points by their IDs. Returns CommandResult JSON. */
  removePoints(pointIds: string[]): string;

  /** Insert a point before an existing point. Returns CommandResult JSON. */
  insertPointBefore(
    beforePointId: string,
    x: number,
    y: number,
    pointType: PointTypeString,
    smooth: boolean
  ): string;

  /** Toggle the smooth property of a point. Returns CommandResult JSON. */
  toggleSmooth(pointId: string): string;
}

/**
 * Get the native FontEngine from window.shiftFont.
 * Throws if not available (e.g., running outside Electron).
 */
export function getNative(): NativeFontEngine {
  if (typeof window === "undefined" || !window.shiftFont) {
    throw new Error(
      "Native FontEngine not available. Are you running in Electron with the preload script?"
    );
  }
  return window.shiftFont as NativeFontEngine;
}

/**
 * Check if the native FontEngine is available.
 */
export function hasNative(): boolean {
  return typeof window !== "undefined" && !!window.shiftFont;
}

// Augment the global Window interface
declare global {
  interface Window {
    shiftFont: NativeFontEngine;
  }
}
