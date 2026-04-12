/**
 * Command Pattern Infrastructure
 *
 * Commands encapsulate glyph mutations as undoable actions.
 * Each command receives a Glyph and calls its mutation methods.
 */

import type { Glyph } from "@/lib/model/Glyph";

/**
 * Context available to commands during execution.
 * Commands receive the reactive Glyph directly — it has all mutation methods.
 */
export interface CommandContext {
  readonly glyph: Glyph;
}

export interface Command<TResult = void> {
  readonly name: string;
  execute(ctx: CommandContext): TResult;
  undo(ctx: CommandContext): void;
  redo(ctx: CommandContext): TResult;
}

export abstract class BaseCommand<TResult = void> implements Command<TResult> {
  abstract readonly name: string;
  abstract execute(ctx: CommandContext): TResult;
  abstract undo(ctx: CommandContext): void;

  redo(ctx: CommandContext): TResult {
    return this.execute(ctx);
  }
}

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
