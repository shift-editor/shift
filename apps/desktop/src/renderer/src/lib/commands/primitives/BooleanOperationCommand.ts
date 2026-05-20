import type { ContourId, GlyphState } from "@shift/types";
import { BaseCommand, type CommandContext } from "../core/Command";

export type BooleanOperation = "union" | "subtract" | "intersect" | "difference";

export class BooleanOperationCommand extends BaseCommand<void> {
  readonly name: string;

  readonly #contourIdA: ContourId;
  readonly #contourIdB: ContourId;
  readonly #operation: BooleanOperation;
  #beforeState: GlyphState | null = null;
  #afterState: GlyphState | null = null;

  constructor(contourIdA: ContourId, contourIdB: ContourId, operation: BooleanOperation) {
    super();
    this.name = `Boolean ${operation}`;
    this.#contourIdA = contourIdA;
    this.#contourIdB = contourIdB;
    this.#operation = operation;
  }

  execute(ctx: CommandContext): void {
    this.#beforeState = ctx.source.state;
    ctx.source.applyBooleanOp(this.#contourIdA, this.#contourIdB, this.#operation);
    this.#afterState = ctx.source.state;
  }

  undo(ctx: CommandContext): void {
    if (this.#beforeState) {
      ctx.source.restore(this.#beforeState);
    }
  }

  override redo(ctx: CommandContext): void {
    if (this.#afterState) {
      ctx.source.restore(this.#afterState);
    } else {
      this.execute(ctx);
    }
  }
}
