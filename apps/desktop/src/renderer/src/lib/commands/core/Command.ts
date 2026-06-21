/**
 * Command Pattern Infrastructure
 *
 * Commands are verb scripts over the active glyph layer. They carry no undo
 * machinery: every verb pushes intents that coalesce into one workspace
 * ledger entry per tick, so a command IS one undo step.
 */

import type { GlyphLayer } from "@/lib/model/Glyph";

/**
 * Context available to commands during execution.
 * Commands receive the active authored glyph layer directly.
 */
export interface CommandContext {
  readonly layer: GlyphLayer;
}

export interface Command<TResult = void> {
  readonly name: string;
  execute(ctx: CommandContext): TResult;
}
