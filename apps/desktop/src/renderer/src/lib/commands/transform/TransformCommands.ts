/**
 * Transform Commands
 *
 * Commands for geometry transformations with full undo/redo support.
 * Each command stores original positions to enable perfect undo.
 */

import type { Point2D, PointId, GlyphSnapshot } from "@shift/types";
import { findPointsInSnapshot } from "@/lib/utils/snapshot";
import type { MatModel } from "@shift/geo";
import { BaseCommand, type CommandContext } from "../core/Command";
import { Transform } from "../../transform/Transform";
import type { ReflectAxis, TransformablePoint } from "@/types/transform";

function getPointsFromSnapshot(
  snapshot: GlyphSnapshot | null,
  pointIds: PointId[],
): TransformablePoint[] {
  if (!snapshot) return [];
  return findPointsInSnapshot(snapshot, pointIds).map((p) => ({
    id: p.id as PointId,
    x: p.x,
    y: p.y,
  }));
}

abstract class BaseTransformCommand extends BaseCommand<void> {
  abstract readonly name: string;

  #pointIds: PointId[];
  #originalPositions: Map<PointId, Point2D> = new Map();

  constructor(pointIds: PointId[]) {
    super();
    this.#pointIds = [...pointIds];
  }

  protected abstract transformPoints(
    points: readonly TransformablePoint[],
  ): TransformablePoint[];

  execute(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;

    const points = getPointsFromSnapshot(ctx.glyph, this.#pointIds);
    if (points.length === 0) return;

    if (this.#originalPositions.size === 0) {
      for (const p of points) {
        this.#originalPositions.set(p.id, { x: p.x, y: p.y });
      }
    }

    const transformed = this.transformPoints(points);
    for (const p of transformed) {
      ctx.fontEngine.editing.movePointTo(p.id, p.x, p.y);
    }
  }

  undo(ctx: CommandContext): void {
    for (const [id, pos] of this.#originalPositions) {
      ctx.fontEngine.editing.movePointTo(id, pos.x, pos.y);
    }
  }

  redo(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;

    const points: TransformablePoint[] = [];
    for (const [id, pos] of this.#originalPositions) {
      points.push({ id, x: pos.x, y: pos.y });
    }

    const transformed = this.transformPoints(points);
    for (const p of transformed) {
      ctx.fontEngine.editing.movePointTo(p.id, p.x, p.y);
    }
  }
}

export class RotatePointsCommand extends BaseTransformCommand {
  readonly name = "Rotate Points";

  #angle: number;
  #origin: Point2D;

  constructor(pointIds: PointId[], angle: number, origin: Point2D) {
    super(pointIds);
    this.#angle = angle;
    this.#origin = origin;
  }

  protected transformPoints(
    points: readonly TransformablePoint[],
  ): TransformablePoint[] {
    return Transform.rotatePoints(points, this.#angle, this.#origin);
  }
}

export class ScalePointsCommand extends BaseTransformCommand {
  readonly name = "Scale Points";

  #sx: number;
  #sy: number;
  #origin: Point2D;

  constructor(pointIds: PointId[], sx: number, sy: number, origin: Point2D) {
    super(pointIds);
    this.#sx = sx;
    this.#sy = sy;
    this.#origin = origin;
  }

  protected transformPoints(
    points: readonly TransformablePoint[],
  ): TransformablePoint[] {
    return Transform.scalePoints(points, this.#sx, this.#sy, this.#origin);
  }
}

export class ReflectPointsCommand extends BaseTransformCommand {
  readonly name = "Reflect Points";

  #axis: ReflectAxis;
  #origin: Point2D;

  constructor(pointIds: PointId[], axis: ReflectAxis, origin: Point2D) {
    super(pointIds);
    this.#axis = axis;
    this.#origin = origin;
  }

  protected transformPoints(
    points: readonly TransformablePoint[],
  ): TransformablePoint[] {
    return Transform.reflectPoints(points, this.#axis, this.#origin);
  }
}

export class TransformMatrixCommand extends BaseTransformCommand {
  readonly name = "Transform Points";

  #matrix: MatModel;
  #origin: Point2D;

  constructor(pointIds: PointId[], matrix: MatModel, origin: Point2D) {
    super(pointIds);
    this.#matrix = { ...matrix };
    this.#origin = origin;
  }

  protected transformPoints(
    points: readonly TransformablePoint[],
  ): TransformablePoint[] {
    return Transform.applyMatrix(points, this.#matrix, this.#origin);
  }
}

/**
 * Move selection to an absolute position by translating all points.
 * The anchor determines which point of the selection bounding box is positioned.
 */
export class MoveSelectionToCommand extends BaseTransformCommand {
  readonly name = "Move Selection To";

  #targetX: number;
  #targetY: number;
  #anchorX: number;
  #anchorY: number;

  constructor(
    pointIds: PointId[],
    targetX: number,
    targetY: number,
    anchorX: number,
    anchorY: number,
  ) {
    super(pointIds);
    this.#targetX = targetX;
    this.#targetY = targetY;
    this.#anchorX = anchorX;
    this.#anchorY = anchorY;
  }

  protected transformPoints(
    points: readonly TransformablePoint[],
  ): TransformablePoint[] {
    const dx = this.#targetX - this.#anchorX;
    const dy = this.#targetY - this.#anchorY;

    return points.map((p) => ({
      id: p.id,
      x: p.x + dx,
      y: p.y + dy,
    }));
  }
}
