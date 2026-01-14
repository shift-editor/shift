/**
 * Type declarations for the Electron preload API
 */

import type { FontMetadata, FontMetrics } from './snapshots';

/**
 * The native FontEngine API exposed via contextBridge
 * This matches the Rust FontEngine NAPI exports
 */
export interface NativeFontEngine {
  // Font loading
  loadFont(path: string): void;

  // Font info
  getMetadata(): FontMetadata;
  getMetrics(): FontMetrics;
  getGlyphCount(): number;

  // Edit session
  startEditSession(unicode: number): void;
  endEditSession(): void;

  // Contour operations
  addEmptyContour(): number;

  // TODO: Add more methods as Rust API expands
  // getGlyphSnapshot(): GlyphSnapshot;
  // addPoint(x: number, y: number, pointType: string, smooth: boolean): string;
  // movePoint(pointId: string, x: number, y: number): void;
  // etc.
}

declare global {
  interface Window {
    /**
     * The Rust FontEngine exposed via Electron's contextBridge
     * Available after preload script runs
     */
    shiftFont: NativeFontEngine;
  }
}

export {};
