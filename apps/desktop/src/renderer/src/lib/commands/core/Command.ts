/**
 * Command Pattern Infrastructure
 *
 * Commands encapsulate actions that modify the glyph/document state.
 * Each command knows how to execute, undo, and redo itself.
 *
 * Benefits:
 * - Full undo/redo support
 * - Actions are testable in isolation
 * - Clear separation between UI interaction and data mutation
 */

import type { EditingManager } from "@/engine/editing";
import type { Signal } from "@/lib/reactive/signal";
import type { GlyphSnapshot } from "@shift/types";

type CommandEditingMethods =
  | "addPoint"
  | "addPointToContour"
  | "insertPointBefore"
  | "movePoints"
  | "movePointTo"
  | "removePoints"
  | "addContour"
  | "removeContour"
  | "closeContour"
  | "openContour"
  | "getActiveContourId"
  | "setActiveContour"
  | "reverseContour"
  | "setXAdvance"
  | "translateLayer"
  | "restoreSnapshot"
  | "pasteContours";

/**
 * Minimal editing surface required by command execution.
 * Derived from the production EditingManager type.
 */
export type CommandEditingAPI = Pick<EditingManager, CommandEditingMethods>;

export interface CommandFontEngine {
  readonly editing: CommandEditingAPI;
  readonly $glyph: Signal<GlyphSnapshot | null>;
}

/**
 * Context available to commands during execution.
 */
export interface CommandContext {
  /** The font engine for performing mutations */
  readonly fontEngine: CommandFontEngine;
  /** Current glyph data (read-only view of state) */
  readonly glyph: GlyphSnapshot | null;
}

/**
 * Base interface for all commands.
 *
 * Commands are executed through CommandHistory, which handles
 * undo/redo stack management.
 *
 * @template TResult - The type returned by execute()
 */
export interface Command<TResult = void> {
  /** Human-readable name for debugging/UI */
  readonly name: string;

  /**
   * Execute the command.
   * Should store any state needed for undo.
   */
  execute(ctx: CommandContext): TResult;

  /**
   * Reverse the effects of execute().
   * Should restore state to before execute() was called.
   */
  undo(ctx: CommandContext): void;

  /**
   * Re-apply the command after an undo.
   * Default implementation can call execute() again.
   */
  redo(ctx: CommandContext): TResult;
}

/**
 * Abstract base class with default redo implementation.
 */
export abstract class BaseCommand<TResult = void> implements Command<TResult> {
  abstract readonly name: string;

  abstract execute(ctx: CommandContext): TResult;
  abstract undo(ctx: CommandContext): void;

  /**
   * Default redo just calls execute again.
   * Override if you need different behavior.
   */
  redo(ctx: CommandContext): TResult {
    return this.execute(ctx);
  }
}

/**
 * A command that groups multiple commands into one.
 * Useful for complex operations that should undo as a single unit.
 */
export class CompositeCommand implements Command<void> {
  readonly name: string;
  #commands: Command<unknown>[];

  constructor(name: string, commands: Command<unknown>[]) {
    this.name = name;
    this.#commands = commands;
  }

  execute(ctx: CommandContext): void {
    for (const cmd of this.#commands) {
      cmd.execute(ctx);
    }
  }

  undo(ctx: CommandContext): void {
    // Undo in reverse order
    for (const cmd of [...this.#commands].reverse()) {
      cmd.undo(ctx);
    }
  }

  redo(ctx: CommandContext): void {
    for (const cmd of this.#commands) {
      cmd.redo(ctx);
    }
  }
}
