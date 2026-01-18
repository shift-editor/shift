/**
 * IOManager - Handles font file operations.
 *
 * Loading, saving, and exporting fonts.
 */

import type { NativeFontEngine } from "./native";

export interface IOManagerContext {
  native: NativeFontEngine;
}

/**
 * IOManager handles font file operations.
 */
export class IOManager {
  #ctx: IOManagerContext;

  constructor(ctx: IOManagerContext) {
    this.#ctx = ctx;
  }

  /**
   * Load a font from a file path.
   */
  loadFont(path: string): void {
    this.#ctx.native.loadFont(path);
  }

  /**
   * Save the current font to a file path.
   * TODO: Implement when Rust backend supports save.
   */
  saveFont(_path: string): void {
    console.warn("IOManager.saveFont() not yet implemented in Rust backend");
  }

  /**
   * Export font to a specific format.
   * TODO: Implement when Rust backend supports export.
   */
  exportFont(_path: string, _format: "ufo" | "otf" | "ttf"): void {
    console.warn("IOManager.exportFont() not yet implemented in Rust backend");
  }
}
