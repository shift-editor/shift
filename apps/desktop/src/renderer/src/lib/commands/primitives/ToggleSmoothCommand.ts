import { PointId } from "@shift/types";
import { BaseCommand, CommandContext } from "../core";

export class ToggleSmoothCommand extends BaseCommand<void> {
  readonly name = "Toggle Smooth";

  #pointId: PointId;

  constructor(pointId: PointId) {
    super();
    this.#pointId = pointId;
  }

  execute(ctx: CommandContext): void {
    ctx.fontEngine.toggleSmooth(this.#pointId);
  }

  undo(ctx: CommandContext): void {
    ctx.fontEngine.toggleSmooth(this.#pointId);
  }
}
