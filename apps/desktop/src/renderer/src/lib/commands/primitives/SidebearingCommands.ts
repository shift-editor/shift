import { BaseCommand, type CommandContext } from "../core";

export class SetXAdvanceCommand extends BaseCommand<void> {
  readonly name = "Set X Advance";

  readonly #beforeXAdvance: number;
  readonly #afterXAdvance: number;

  constructor(beforeXAdvance: number, afterXAdvance: number) {
    super();
    this.#beforeXAdvance = beforeXAdvance;
    this.#afterXAdvance = afterXAdvance;
  }

  execute(ctx: CommandContext): void {
    ctx.glyph.setXAdvance(this.#afterXAdvance);
  }

  undo(ctx: CommandContext): void {
    ctx.glyph.setXAdvance(this.#beforeXAdvance);
  }

  override redo(ctx: CommandContext): void {
    ctx.glyph.setXAdvance(this.#afterXAdvance);
  }
}

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
    ctx.glyph.setXAdvance(this.#afterXAdvance);
  }

  undo(ctx: CommandContext): void {
    ctx.glyph.setXAdvance(this.#beforeXAdvance);
  }

  override redo(ctx: CommandContext): void {
    ctx.glyph.setXAdvance(this.#afterXAdvance);
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
    ctx.glyph.translateLayer(this.#deltaX, 0);
    ctx.glyph.setXAdvance(this.#afterXAdvance);
  }

  undo(ctx: CommandContext): void {
    ctx.glyph.setXAdvance(this.#beforeXAdvance);
    ctx.glyph.translateLayer(-this.#deltaX, 0);
  }

  override redo(ctx: CommandContext): void {
    ctx.glyph.translateLayer(this.#deltaX, 0);
    ctx.glyph.setXAdvance(this.#afterXAdvance);
  }
}
