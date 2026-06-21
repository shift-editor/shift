import type { Command, CommandContext } from "../core";

export class SetXAdvanceCommand implements Command<void> {
  readonly name = "Set X Advance";

  readonly #xAdvance: number;

  constructor(xAdvance: number) {
    this.#xAdvance = xAdvance;
  }

  execute(ctx: CommandContext): void {
    ctx.layer.setXAdvance(this.#xAdvance);
  }
}

export class SetRightSidebearingCommand implements Command<void> {
  readonly name = "Set Right Sidebearing";

  readonly #xAdvance: number;

  constructor(xAdvance: number) {
    this.#xAdvance = xAdvance;
  }

  execute(ctx: CommandContext): void {
    ctx.layer.setXAdvance(this.#xAdvance);
  }
}

export class SetLeftSidebearingCommand implements Command<void> {
  readonly name = "Set Left Sidebearing";

  readonly #xAdvance: number;
  readonly #deltaX: number;

  constructor(xAdvance: number, deltaX: number) {
    this.#xAdvance = xAdvance;
    this.#deltaX = deltaX;
  }

  execute(ctx: CommandContext): void {
    ctx.layer.translateLayer(this.#deltaX, 0);
    ctx.layer.setXAdvance(this.#xAdvance);
  }
}
