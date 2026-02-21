import { BaseCommand, type CommandContext } from "../core";

export class SetRightSidebearingCommand extends BaseCommand<void> {
  readonly name = "Set Right Sidebearing";

  readonly #beforeXAdvance: number;
  readonly #afterXAdvance: number;

  constructor(beforeXAdvance: number, afterXAdvance: number) {
    super();
    this.#beforeXAdvance = beforeXAdvance;
    this.#afterXAdvance = afterXAdvance;
  }

  execute(ctx: CommandContext): void {
    ctx.fontEngine.editing.setXAdvance(this.#afterXAdvance);
  }

  undo(ctx: CommandContext): void {
    ctx.fontEngine.editing.setXAdvance(this.#beforeXAdvance);
  }

  override redo(ctx: CommandContext): void {
    ctx.fontEngine.editing.setXAdvance(this.#afterXAdvance);
  }
}

export class SetLeftSidebearingCommand extends BaseCommand<void> {
  readonly name = "Set Left Sidebearing";

  readonly #beforeXAdvance: number;
  readonly #afterXAdvance: number;
  readonly #deltaX: number;

  constructor(beforeXAdvance: number, afterXAdvance: number, deltaX: number) {
    super();
    this.#beforeXAdvance = beforeXAdvance;
    this.#afterXAdvance = afterXAdvance;
    this.#deltaX = deltaX;
  }

  execute(ctx: CommandContext): void {
    ctx.fontEngine.editing.translateLayer(this.#deltaX, 0);
    ctx.fontEngine.editing.setXAdvance(this.#afterXAdvance);
  }

  undo(ctx: CommandContext): void {
    ctx.fontEngine.editing.setXAdvance(this.#beforeXAdvance);
    ctx.fontEngine.editing.translateLayer(-this.#deltaX, 0);
  }

  override redo(ctx: CommandContext): void {
    ctx.fontEngine.editing.translateLayer(this.#deltaX, 0);
    ctx.fontEngine.editing.setXAdvance(this.#afterXAdvance);
  }
}
