/**
 * Command Pattern Core Interfaces
 *
 * These interfaces define the contract for commands in the editor.
 * Concrete implementations remain in the application where they
 * have access to FontEngine.
 */

/**
 * Context available to commands during execution.
 * The concrete context is defined by the application.
 */
export interface CommandContext {
  /** Current snapshot (read-only view of state) */
  readonly snapshot: unknown;
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
    for (let i = this.#commands.length - 1; i >= 0; i--) {
      this.#commands[i].undo(ctx);
    }
  }

  redo(ctx: CommandContext): void {
    for (const cmd of this.#commands) {
      cmd.redo(ctx);
    }
  }
}
