import type { ContourId, PointType, PointId } from "@shift/types";
import { Point } from "@shift/glyph-state";
import { BaseCommand, type CommandContext } from "../core/Command";

/**
 * Appends a new point to the active contour. Returns the engine-assigned PointId
 * so callers can immediately reference the point for follow-up commands (e.g.
 * bezier handle placement). Undo removes the point by id.
 */
export class AddPointCommand extends BaseCommand<PointId> {
  readonly name = "Add Point";

  #contourId: ContourId;
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
    contourId: ContourId,
  ) {
    super();
    this.#contourId = contourId;
    this.#x = x;
    this.#y = y;
    this.#pointType = pointType;
    this.#smooth = smooth;
  }

  execute(ctx: CommandContext): PointId {
    this.#resultId = ctx.source.addPoint(
      this.#contourId,
      Point.create({ x: this.#x, y: this.#y }, this.#pointType, this.#smooth),
    );
    return this.#resultId;
  }

  undo(ctx: CommandContext): void {
    if (this.#resultId) {
      ctx.source.removePoints([this.#resultId]);
    }
  }

  override redo(ctx: CommandContext): PointId {
    return this.execute(ctx);
  }
}

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
