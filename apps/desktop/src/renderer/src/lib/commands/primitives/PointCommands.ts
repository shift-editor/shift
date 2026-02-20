import type { PointType, PointId } from "@shift/types";
import { BaseCommand, type CommandContext } from "../core/Command";

/**
 * Appends a new point to the active contour. Returns the engine-assigned PointId
 * so callers can immediately reference the point for follow-up commands (e.g.
 * bezier handle placement). Undo removes the point by id.
 */
export class AddPointCommand extends BaseCommand<PointId> {
  readonly name = "Add Point";

  #x: number;
  #y: number;
  #pointType: PointType;
  #smooth: boolean;

  #resultId: PointId | null = null;

  constructor(x: number, y: number, pointType: PointType, smooth: boolean = false) {
    super();
    this.#x = x;
    this.#y = y;
    this.#pointType = pointType;
    this.#smooth = smooth;
  }

  execute(ctx: CommandContext): PointId {
    this.#resultId = ctx.fontEngine.editing.addPoint({
      id: "" as PointId,
      x: this.#x,
      y: this.#y,
      pointType: this.#pointType,
      smooth: this.#smooth,
    });
    return this.#resultId;
  }

  undo(ctx: CommandContext): void {
    if (this.#resultId) {
      ctx.fontEngine.editing.removePoints([this.#resultId]);
    }
  }

  redo(ctx: CommandContext): PointId {
    return this.execute(ctx);
  }
}

/**
 * Translates one or more points by a delta vector. Used for drag operations
 * where the displacement is known. Undo applies the inverse delta.
 */
export class MovePointsCommand extends BaseCommand<void> {
  readonly name = "Move Points";

  #pointIds: PointId[];
  #dx: number;
  #dy: number;

  constructor(pointIds: PointId[], dx: number, dy: number) {
    super();
    this.#pointIds = [...pointIds];
    this.#dx = dx;
    this.#dy = dy;
  }

  execute(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;
    ctx.fontEngine.editing.movePoints(this.#pointIds, { x: this.#dx, y: this.#dy });
  }

  undo(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;
    // Move back by the negative delta
    ctx.fontEngine.editing.movePoints(this.#pointIds, { x: -this.#dx, y: -this.#dy });
  }

  redo(ctx: CommandContext): void {
    this.execute(ctx);
  }
}

/**
 * Deletes one or more points from the glyph. Snapshots each removed point's
 * contour, position, type, and smoothness so undo can re-add them in order.
 */
export class RemovePointsCommand extends BaseCommand<void> {
  readonly name = "Remove Points";

  #pointIds: PointId[];

  #removedPoints: Array<{
    contourId: string;
    x: number;
    y: number;
    pointType: PointType;
    smooth: boolean;
  }> = [];

  constructor(pointIds: PointId[]) {
    super();
    this.#pointIds = [...pointIds];
  }

  execute(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;

    this.#removedPoints = [];
    if (ctx.glyph) {
      for (const contour of ctx.glyph.contours) {
        for (const point of contour.points) {
          if (this.#pointIds.includes(point.id)) {
            this.#removedPoints.push({
              contourId: contour.id,
              x: point.x,
              y: point.y,
              pointType: point.pointType,
              smooth: point.smooth,
            });
          }
        }
      }
    }

    ctx.fontEngine.editing.removePoints(this.#pointIds);
  }

  undo(ctx: CommandContext): void {
    for (const pt of this.#removedPoints) {
      ctx.fontEngine.editing.addPoint({
        id: "" as PointId,
        x: pt.x,
        y: pt.y,
        pointType: pt.pointType,
        smooth: pt.smooth,
      });
    }
  }

  redo(ctx: CommandContext): void {
    ctx.fontEngine.editing.removePoints(this.#pointIds);
  }
}
