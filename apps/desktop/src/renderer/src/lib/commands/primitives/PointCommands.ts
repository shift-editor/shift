import type { PointId } from "@shift/types";
import { BaseCommand, type CommandContext } from "../core/Command";

export class ToggleSmoothCommand extends BaseCommand<void> {
  readonly name = "Toggle Smooth";

  readonly #pointId: PointId;

  constructor(pointId: PointId) {
    super();
    this.#pointId = pointId;
  }

  execute(ctx: CommandContext): void {
    ctx.source.toggleSmooth(this.#pointId);
  }

  undo(ctx: CommandContext): void {
    ctx.source.toggleSmooth(this.#pointId);
  }
}
