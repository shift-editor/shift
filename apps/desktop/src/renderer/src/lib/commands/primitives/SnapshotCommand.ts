import type { GlyphSnapshot } from "@shift/types";
import type { CommandContext } from "../core";

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
