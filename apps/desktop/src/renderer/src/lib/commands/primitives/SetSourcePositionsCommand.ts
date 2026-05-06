import { BaseCommand, type CommandContext } from "../core/Command";
import type { GlyphSource, SourcePositions } from "@/lib/model/Glyph";

/**
 * Replays absolute point/anchor position updates through the source bulk path.
 * This is the undoable form of `GlyphSource.setPositions`.
 */
export class SetSourcePositionsCommand extends BaseCommand<void> {
  readonly name: string;

  readonly #before: SourcePositions;
  readonly #after: SourcePositions;

  constructor(label: string, before: SourcePositions, after: SourcePositions) {
    super();
    this.name = label;
    this.#before = before;
    this.#after = after;
  }

  execute(ctx: CommandContext): void {
    ctx.source.setPositions(this.#after);
  }

  undo(ctx: CommandContext): void {
    ctx.source.setPositions(this.#before);
  }

  override redo(ctx: CommandContext): void {
    ctx.source.setPositions(this.#after);
  }

  static fromSource(label: string, source: GlyphSource, after: SourcePositions) {
    if (after.length === 0) return null;

    const before = source.positionsFor(after);
    if (before.length !== after.length) return null;

    return new SetSourcePositionsCommand(label, before, after);
  }
}
