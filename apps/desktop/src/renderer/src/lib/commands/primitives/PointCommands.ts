import type { ContourId, PointType, PointId } from "@shift/types";
import { BaseCommand, type CommandContext } from "../core/Command";

/**
 * Appends a new point to the active contour. Returns the engine-assigned PointId
 * so callers can immediately reference the point for follow-up commands (e.g.
 * bezier handle placement). Undo removes the point by id.
 */
export class AddPointCommand extends BaseCommand<PointId> {
  readonly name = "Add Point";

  #contourId: ContourId | null;
  #x: number;
  #y: number;
  #pointType: PointType;
  #smooth: boolean;

  #resultId: PointId | null = null;

  constructor(
    x: number,
    y: number,
    pointType: PointType,
    smooth: boolean = false,
    contourId: ContourId | null = null,
  ) {
    super();
    this.#contourId = contourId;
    this.#x = x;
    this.#y = y;
    this.#pointType = pointType;
    this.#smooth = smooth;
  }

  execute(ctx: CommandContext): PointId {
    const contourId = this.#contourId ?? ctx.bridge.getActiveContourId();
    if (!contourId) {
      throw new Error("No active contour");
    }
    this.#resultId = ctx.bridge.addPointToContour(contourId, {
      x: this.#x,
      y: this.#y,
      pointType: this.#pointType,
      smooth: this.#smooth,
    });
    return this.#resultId;
  }

  undo(ctx: CommandContext): void {
    if (this.#resultId) {
      ctx.bridge.removePoints([this.#resultId]);
    }
  }

  override redo(ctx: CommandContext): PointId {
    return this.execute(ctx);
  }
}
