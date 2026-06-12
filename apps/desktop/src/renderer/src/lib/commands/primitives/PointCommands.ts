import type { PointId } from "@shift/types";
import type { Command, CommandContext } from "../core/Command";

export class ToggleSmoothCommand implements Command<void> {
  readonly name = "Toggle Smooth";

  readonly #pointId: PointId;

  constructor(pointId: PointId) {
    this.#pointId = pointId;
  }

  execute(ctx: CommandContext): void {
    ctx.source.toggleSmooth(this.#pointId);
  }
}
