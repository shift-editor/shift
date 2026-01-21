/**
 * InfoManager - Provides font metadata and metrics.
 *
 * Read-only operations that don't require an edit session.
 */

import type { NativeFontEngine } from "./native";

/**
 * Font metadata (family, style, version).
 */
export interface FontMetadata {
  family: string;
  styleName: string;
  version: number;
}

/**
 * Font metrics (UPM, ascender, descender, etc.).
 */
export interface FontMetrics {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  capHeight: number;
  xHeight: number;
}

export interface InfoManagerContext {
  native: NativeFontEngine;
}

/**
 * InfoManager provides font metadata and metrics.
 */
export class InfoManager {
  #ctx: InfoManagerContext;

  constructor(ctx: InfoManagerContext) {
    this.#ctx = ctx;
  }

  /**
   * Get font metadata (family, style, version).
   */
  getMetadata(): FontMetadata {
    const meta = this.#ctx.native.getMetadata();
    return {
      family: meta.family ?? "",
      styleName: meta.styleName ?? "",
      version: meta.versionMajor ?? 1,
    };
  }

  /**
   * Get font metrics (UPM, ascender, descender, etc.).
   */
  getMetrics(): FontMetrics {
    const metrics = this.#ctx.native.getMetrics();
    return {
      unitsPerEm: metrics.unitsPerEm,
      ascender: metrics.ascender,
      descender: metrics.descender,
      capHeight: metrics.capHeight,
      xHeight: metrics.xHeight,
    };
  }

  /**
   * Get the total number of glyphs in the font.
   */
  getGlyphCount(): number {
    return this.#ctx.native.getGlyphCount();
  }
}
