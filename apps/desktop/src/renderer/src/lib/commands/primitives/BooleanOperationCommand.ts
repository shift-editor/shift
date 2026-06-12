import type { ContourId } from "@shift/types";
import type { Command, CommandContext } from "../core/Command";

export type BooleanOperation = "union" | "subtract" | "intersect" | "difference";

export class BooleanOperationCommand implements Command<void> {
  readonly name: string;

  readonly #contourIdA: ContourId;
  readonly #contourIdB: ContourId;
  readonly #operation: BooleanOperation;

  constructor(contourIdA: ContourId, contourIdB: ContourId, operation: BooleanOperation) {
    this.name = `Boolean ${operation}`;
    this.#contourIdA = contourIdA;
    this.#contourIdB = contourIdB;
    this.#operation = operation;
  }

  execute(ctx: CommandContext): void {
    ctx.source.applyBooleanOp(this.#contourIdA, this.#contourIdB, this.#operation);
  }
}
