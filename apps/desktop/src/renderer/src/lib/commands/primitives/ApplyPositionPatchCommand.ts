import { BaseCommand, type CommandContext } from "../core/Command";
import type { GlyphSource, SourcePositions } from "@/lib/model/Glyph";

/**
 * Replays a sparse point/anchor position patch through the source edit path.
 *
 * Commands are not preview-backed, so execute/undo/redo use
 * `GlyphSource.applyPositionPatch`: commit the sparse patch to Rust and apply
 * the same sparse patch to local geometry.
 */
export class ApplyPositionPatchCommand extends BaseCommand<void> {
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
    ctx.source.applyPositionPatch(this.#after);
  }

  undo(ctx: CommandContext): void {
    ctx.source.applyPositionPatch(this.#before);
  }

  override redo(ctx: CommandContext): void {
    ctx.source.applyPositionPatch(this.#after);
  }

  static fromSource(label: string, source: GlyphSource, after: SourcePositions) {
    if (after.length === 0) return null;

    const before = source.positionsFor(after);
    if (before.length !== after.length) return null;

    return new ApplyPositionPatchCommand(label, before, after);
  }
}
