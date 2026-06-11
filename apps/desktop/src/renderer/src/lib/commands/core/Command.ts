/**
 * Command Pattern Infrastructure
 *
 * Commands encapsulate source mutations as undoable actions.
 */

import type { GlyphSource } from "@/lib/model/Glyph";

/**
 * Context available to commands during execution.
 * Commands receive the active authored source directly.
 */
export interface CommandContext {
  readonly source: GlyphSource;
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
