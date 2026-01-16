/**
 * HistoryManager - Handles undo/redo operations.
 *
 * Note: The Rust backend may not yet implement undo/redo.
 * This manager provides the interface for when it does.
 */

import type { NativeFontEngine } from "./native";

export interface HistoryManagerContext {
  native: NativeFontEngine;
  hasSession: () => boolean;
}

/**
 * HistoryManager handles undo/redo operations.
 *
 * TODO: Implement when Rust backend supports undo/redo.
 */
export class HistoryManager {
  #ctx: HistoryManagerContext;

  // Internal tracking until Rust supports these
  #canUndo: boolean = false;
  #canRedo: boolean = false;

  constructor(ctx: HistoryManagerContext) {
    this.#ctx = ctx;
  }

  /**
   * Undo the last operation.
   * @throws Error if undo is not available.
   */
  undo(): void {
    if (!this.canUndo()) {
      throw new Error("Nothing to undo");
    }
    // TODO: Call native.undo() when implemented
    console.warn("HistoryManager.undo() not yet implemented in Rust backend");
  }

  /**
   * Redo the last undone operation.
   * @throws Error if redo is not available.
   */
  redo(): void {
    if (!this.canRedo()) {
      throw new Error("Nothing to redo");
    }
    // TODO: Call native.redo() when implemented
    console.warn("HistoryManager.redo() not yet implemented in Rust backend");
  }

  /**
   * Check if undo is available.
   */
  canUndo(): boolean {
    if (!this.#ctx.hasSession()) {
      return false;
    }
    // TODO: Call native.canUndo() when implemented
    return this.#canUndo;
  }

  /**
   * Check if redo is available.
   */
  canRedo(): boolean {
    if (!this.#ctx.hasSession()) {
      return false;
    }
    // TODO: Call native.canRedo() when implemented
    return this.#canRedo;
  }

  /**
   * Update history state from CommandResult.
   * Called internally by other managers.
   */
  _updateFromResult(canUndo: boolean, canRedo: boolean): void {
    this.#canUndo = canUndo;
    this.#canRedo = canRedo;
  }
}
