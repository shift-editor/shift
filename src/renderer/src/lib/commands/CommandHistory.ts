/**
 * CommandHistory - Manages undo/redo for commands.
 *
 * Maintains two stacks:
 * - undoStack: commands that can be undone
 * - redoStack: commands that have been undone and can be redone
 *
 * When a new command is executed, the redo stack is cleared.
 */

import { signal, computed, type WritableSignal, type ComputedSignal } from "@/lib/reactive/signal";
import type { Command, CommandContext } from "./Command";
import type { FontEngine } from "@/engine/FontEngine";
import type { GlyphSnapshot } from "@/types/generated";

export interface CommandHistoryOptions {
  /** Maximum number of commands to keep in history */
  maxHistory?: number;
}

export class CommandHistory {
  #undoStack: Command<unknown>[] = [];
  #redoStack: Command<unknown>[] = [];
  #maxHistory: number;
  #fontEngine: FontEngine;
  #getSnapshot: () => GlyphSnapshot | null;

  // Reactive signals for UI binding
  readonly undoCount: WritableSignal<number>;
  readonly redoCount: WritableSignal<number>;
  readonly canUndo: ComputedSignal<boolean>;
  readonly canRedo: ComputedSignal<boolean>;

  constructor(
    fontEngine: FontEngine,
    getSnapshot: () => GlyphSnapshot | null,
    options: CommandHistoryOptions = {}
  ) {
    this.#fontEngine = fontEngine;
    this.#getSnapshot = getSnapshot;
    this.#maxHistory = options.maxHistory ?? 100;

    this.undoCount = signal(0);
    this.redoCount = signal(0);
    this.canUndo = computed(() => this.undoCount.value > 0);
    this.canRedo = computed(() => this.redoCount.value > 0);
  }

  #createContext(): CommandContext {
    return {
      fontEngine: this.#fontEngine,
      snapshot: this.#getSnapshot(),
    };
  }

  #updateCounts(): void {
    this.undoCount.set(this.#undoStack.length);
    this.redoCount.set(this.#redoStack.length);
  }

  /**
   * Execute a command and add it to the undo stack.
   * Clears the redo stack.
   *
   * @returns The result of the command's execute method
   */
  execute<TResult>(command: Command<TResult>): TResult {
    const ctx = this.#createContext();
    const result = command.execute(ctx);

    // Add to undo stack
    this.#undoStack.push(command);

    // Trim if exceeding max history
    if (this.#undoStack.length > this.#maxHistory) {
      this.#undoStack.shift();
    }

    // Clear redo stack on new action
    this.#redoStack = [];

    this.#updateCounts();
    return result;
  }

  /**
   * Undo the most recent command.
   * Moves it to the redo stack.
   *
   * @returns true if a command was undone, false if stack was empty
   */
  undo(): boolean {
    const command = this.#undoStack.pop();
    if (!command) return false;

    const ctx = this.#createContext();
    command.undo(ctx);

    this.#redoStack.push(command);
    this.#updateCounts();
    return true;
  }

  /**
   * Redo the most recently undone command.
   * Moves it back to the undo stack.
   *
   * @returns true if a command was redone, false if redo stack was empty
   */
  redo(): boolean {
    const command = this.#redoStack.pop();
    if (!command) return false;

    const ctx = this.#createContext();
    command.redo(ctx);

    this.#undoStack.push(command);
    this.#updateCounts();
    return true;
  }

  /**
   * Clear all history (both undo and redo stacks).
   */
  clear(): void {
    this.#undoStack = [];
    this.#redoStack = [];
    this.#updateCounts();
  }

  /**
   * Get the name of the command that would be undone.
   * Useful for UI ("Undo Add Point").
   */
  getUndoLabel(): string | null {
    const command = this.#undoStack[this.#undoStack.length - 1];
    return command?.name ?? null;
  }

  /**
   * Get the name of the command that would be redone.
   * Useful for UI ("Redo Add Point").
   */
  getRedoLabel(): string | null {
    const command = this.#redoStack[this.#redoStack.length - 1];
    return command?.name ?? null;
  }
}
