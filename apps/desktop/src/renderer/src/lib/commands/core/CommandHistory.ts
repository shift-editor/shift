/**
 * CommandHistory - Manages undo/redo for commands.
 *
 * Maintains two stacks:
 * - undoStack: commands that can be undone
 * - redoStack: commands that have been undone and can be redone
 *
 * When a new command is executed, the redo stack is cleared.
 *
 * Supports batching via beginBatch()/endBatch() - commands executed
 * during a batch are grouped into a single undo step.
 */

import {
  signal,
  computed,
  type WritableSignal,
  type ComputedSignal,
} from "@/lib/reactive/signal";
import type { Command, CommandContext } from "./Command";
import { CompositeCommand } from "./Command";
import type { FontEngine } from "@/engine/FontEngine";
import type { GlyphSnapshot } from "@shift/types";

export interface CommandHistoryOptions {
  /** Maximum number of commands to keep in history */
  maxHistory?: number;
  /** Callback invoked when commands are executed or recorded */
  onDirty?: () => void;
}

interface BatchState {
  name: string;
  commands: Command<unknown>[];
}

export class CommandHistory {
  #undoStack: Command<unknown>[] = [];
  #redoStack: Command<unknown>[] = [];
  #maxHistory: number;
  #fontEngine: FontEngine;
  #getSnapshot: () => GlyphSnapshot | null;
  #batch: BatchState | null = null;
  #onDirty?: () => void;

  // Reactive signals for UI binding
  readonly undoCount: WritableSignal<number>;
  readonly redoCount: WritableSignal<number>;
  readonly canUndo: ComputedSignal<boolean>;
  readonly canRedo: ComputedSignal<boolean>;

  constructor(
    fontEngine: FontEngine,
    getSnapshot: () => GlyphSnapshot | null,
    options: CommandHistoryOptions = {},
  ) {
    this.#fontEngine = fontEngine;
    this.#getSnapshot = getSnapshot;
    this.#maxHistory = options.maxHistory ?? 100;
    this.#onDirty = options.onDirty;

    this.undoCount = signal(0);
    this.redoCount = signal(0);
    this.canUndo = computed(() => this.undoCount.value > 0);
    this.canRedo = computed(() => this.redoCount.value > 0);
  }

  get isBatching(): boolean {
    return this.#batch !== null;
  }

  setOnDirty(callback: () => void): void {
    this.#onDirty = callback;
  }

  #createContext(): CommandContext {
    return {
      fontEngine: this.#fontEngine,
      glyph: this.#getSnapshot(),
    };
  }

  #updateCounts(): void {
    this.undoCount.set(this.#undoStack.length);
    this.redoCount.set(this.#redoStack.length);
  }

  /**
   * Start a batch of commands that will be grouped into a single undo step.
   * Call endBatch() when done.
   */
  beginBatch(name: string): void {
    if (this.#batch) {
      throw new Error("Cannot nest batches - already in a batch");
    }
    this.#batch = { name, commands: [] };
  }

  /**
   * End the current batch and add all batched commands as a single undo step.
   */
  endBatch(): void {
    if (!this.#batch) {
      throw new Error("Not in a batch");
    }

    const { name, commands } = this.#batch;
    this.#batch = null;

    if (commands.length === 0) {
      return;
    }

    if (commands.length === 1) {
      this.#addToUndoStack(commands[0]);
    } else {
      this.#addToUndoStack(new CompositeCommand(name, commands));
    }
  }

  /**
   * Cancel the current batch without adding to undo stack.
   * Commands already executed are NOT rolled back.
   */
  cancelBatch(): void {
    this.#batch = null;
  }

  #addToUndoStack(command: Command<unknown>): void {
    this.#undoStack.push(command);

    if (this.#undoStack.length > this.#maxHistory) {
      this.#undoStack.shift();
    }

    this.#redoStack = [];
    this.#updateCounts();
  }

  /**
   * Execute a command and add it to the undo stack.
   * If in a batch, the command is collected for later grouping.
   * Clears the redo stack.
   *
   * @returns The result of the command's execute method
   */
  execute<TResult>(command: Command<TResult>): TResult {
    const ctx = this.#createContext();
    const result = command.execute(ctx);

    if (this.#batch) {
      this.#batch.commands.push(command);
    } else {
      this.#addToUndoStack(command);
    }

    this.#onDirty?.();

    return result;
  }

  /**
   * Record a command that was already executed externally.
   * The command's execute() is NOT called, but it's added to the undo stack
   * so it can be undone later.
   *
   * Use this for operations that happen incrementally (like dragging)
   * where the action has already been performed and you just need undo support.
   */
  record(command: Command<unknown>): void {
    if (this.#batch) {
      this.#batch.commands.push(command);
    } else {
      this.#addToUndoStack(command);
    }

    this.#onDirty?.();
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
