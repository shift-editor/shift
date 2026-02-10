import type { GlyphSnapshot } from "@shift/types";
import type { CommandContext } from "../core";

/**
 * A whole-glyph undo/redo command that stores before and after snapshots.
 * Use this as a catch-all when fine-grained point commands are impractical
 * (e.g. complex multi-step operations). Execute and redo restore the "after"
 * snapshot; undo restores the "before" snapshot. The label is caller-provided
 * so the undo history displays meaningful operation names.
 */
export class SnapshotCommand {
  readonly name: string;
  readonly #before: GlyphSnapshot;
  readonly #after: GlyphSnapshot;

  constructor(label: string, before: GlyphSnapshot, after: GlyphSnapshot) {
    this.name = label;
    this.#before = before;
    this.#after = after;
  }

  execute(ctx: CommandContext): void {
    ctx.fontEngine.editing.restoreSnapshot(this.#after);
  }

  undo(ctx: CommandContext): void {
    ctx.fontEngine.editing.restoreSnapshot(this.#before);
  }

  redo(ctx: CommandContext): void {
    ctx.fontEngine.editing.restoreSnapshot(this.#after);
  }
}
