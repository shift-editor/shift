/**
 * Command Pattern Infrastructure
 *
 * Commands are verb scripts over the active glyph source. They carry no undo
 * machinery: every verb pushes intents that coalesce into one workspace
 * ledger entry per tick, so a command IS one undo step.
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
}
