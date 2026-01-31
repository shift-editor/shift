/**
 * Point manipulation commands.
 *
 * These commands handle adding, moving, and removing points.
 * Each stores the state needed to undo the operation.
 */

import type { PointType, PointId } from "@shift/types";
import { asPointId } from "@shift/types";
import { BaseCommand, type CommandContext } from "../core/Command";

/**
 * Add a point to the active contour.
 */
export class AddPointCommand extends BaseCommand<PointId> {
  readonly name = "Add Point";

  #x: number;
  #y: number;
  #pointType: PointType;
  #smooth: boolean;

  // Stored for undo
  #resultId: PointId | null = null;

  constructor(x: number, y: number, pointType: PointType, smooth: boolean = false) {
    super();
    this.#x = x;
    this.#y = y;
    this.#pointType = pointType;
    this.#smooth = smooth;
  }

  execute(ctx: CommandContext): PointId {
    this.#resultId = ctx.fontEngine.editing.addPoint(
      this.#x,
      this.#y,
      this.#pointType,
      this.#smooth,
    );
    return this.#resultId;
  }

  undo(ctx: CommandContext): void {
    if (this.#resultId) {
      ctx.fontEngine.editing.removePoints([this.#resultId]);
    }
  }

  redo(ctx: CommandContext): PointId {
    // Re-execute to get a new point ID
    return this.execute(ctx);
  }
}

/**
 * Move multiple points by a delta.
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
    ctx.fontEngine.editing.movePoints(this.#pointIds, this.#dx, this.#dy);
  }

  undo(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;
    // Move back by the negative delta
    ctx.fontEngine.editing.movePoints(this.#pointIds, -this.#dx, -this.#dy);
  }

  redo(ctx: CommandContext): void {
    this.execute(ctx);
  }
}

/**
 * Move a single point to an absolute position.
 */
export class MovePointToCommand extends BaseCommand<void> {
  readonly name = "Move Point";

  #pointId: PointId;
  #x: number;
  #y: number;

  // Stored for undo
  #originalX: number | null = null;
  #originalY: number | null = null;

  constructor(pointId: PointId, x: number, y: number) {
    super();
    this.#pointId = pointId;
    this.#x = x;
    this.#y = y;
  }

  execute(ctx: CommandContext): void {
    // Find and store original position
    if (ctx.glyph) {
      for (const contour of ctx.glyph.contours) {
        const point = contour.points.find((p) => p.id === this.#pointId);
        if (point) {
          this.#originalX = point.x;
          this.#originalY = point.y;
          break;
        }
      }
    }

    ctx.fontEngine.editing.movePointTo(this.#pointId, this.#x, this.#y);
  }

  undo(ctx: CommandContext): void {
    if (this.#originalX !== null && this.#originalY !== null) {
      ctx.fontEngine.editing.movePointTo(this.#pointId, this.#originalX, this.#originalY);
    }
  }

  redo(ctx: CommandContext): void {
    ctx.fontEngine.editing.movePointTo(this.#pointId, this.#x, this.#y);
  }
}

/**
 * Remove multiple points.
 */
export class RemovePointsCommand extends BaseCommand<void> {
  readonly name = "Remove Points";

  #pointIds: PointId[];

  // Stored for undo - we need to store full point data to recreate them
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

    // Store point data before removal for undo
    this.#removedPoints = [];
    if (ctx.glyph) {
      for (const contour of ctx.glyph.contours) {
        for (const point of contour.points) {
          if (this.#pointIds.includes(asPointId(point.id))) {
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
    // Re-add the removed points
    // Note: This won't restore exact IDs, but will restore the geometry
    for (const pt of this.#removedPoints) {
      ctx.fontEngine.editing.addPoint(pt.x, pt.y, pt.pointType, pt.smooth);
    }
  }

  redo(ctx: CommandContext): void {
    // Can't use stored IDs since they changed after undo
    // This is a limitation - for full fidelity we'd need more complex tracking
    ctx.fontEngine.editing.removePoints(this.#pointIds);
  }
}
