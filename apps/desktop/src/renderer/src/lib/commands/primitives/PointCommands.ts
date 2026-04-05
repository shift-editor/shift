import type { ContourId, PointType, PointId } from "@shift/types";
import { Glyphs } from "@shift/font";
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
    const contourId = this.#contourId ?? ctx.fontEngine.getActiveContourId();
    if (!contourId) {
      throw new Error("No active contour");
    }
    this.#resultId = ctx.fontEngine.addPointToContour(contourId, {
      x: this.#x,
      y: this.#y,
      pointType: this.#pointType,
      smooth: this.#smooth,
    });
    return this.#resultId;
  }

  undo(ctx: CommandContext): void {
    if (this.#resultId) {
      ctx.fontEngine.removePoints([this.#resultId]);
    }
  }

  override redo(ctx: CommandContext): PointId {
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
    ctx.fontEngine.movePoints(this.#pointIds, { x: this.#dx, y: this.#dy });
  }

  undo(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;
    // Move back by the negative delta
    ctx.fontEngine.movePoints(this.#pointIds, { x: -this.#dx, y: -this.#dy });
  }

  override redo(ctx: CommandContext): void {
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
    contourId: ContourId;
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
      for (const pointId of this.#pointIds) {
        const found = Glyphs.findPoint(ctx.glyph, pointId);
        if (found) {
          this.#removedPoints.push({
            contourId: found.contour.id,
            x: found.point.x,
            y: found.point.y,
            pointType: found.point.pointType,
            smooth: found.point.smooth,
          });
        }
      }
    }

    ctx.fontEngine.removePoints(this.#pointIds);
  }

  undo(ctx: CommandContext): void {
    for (const pt of this.#removedPoints) {
      ctx.fontEngine.addPointToContour(pt.contourId, {
        x: pt.x,
        y: pt.y,
        pointType: pt.pointType,
        smooth: pt.smooth,
      });
    }
  }

  override redo(ctx: CommandContext): void {
    ctx.fontEngine.removePoints(this.#pointIds);
  }
}
