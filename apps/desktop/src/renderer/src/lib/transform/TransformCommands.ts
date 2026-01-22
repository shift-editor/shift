/**
 * Transform Commands
 *
 * Commands for geometry transformations with full undo/redo support.
 * Each command stores original positions to enable perfect undo.
 */

import type { Point2D } from "@/types/math";
import type { PointId } from "@/types/ids";
import type { GlyphSnapshot } from "@/types/generated";
import { BaseCommand, type CommandContext } from "../commands/Command";
import { TransformService } from "./TransformService";
import type { ReflectAxis, TransformablePoint } from "./types";

/**
 * Helper to extract points from snapshot by IDs.
 */
function getPointsFromSnapshot(
  snapshot: GlyphSnapshot | null,
  pointIds: PointId[],
): TransformablePoint[] {
  if (!snapshot) return [];

  const result: TransformablePoint[] = [];
  const idSet = new Set(pointIds);

  for (const contour of snapshot.contours) {
    for (const point of contour.points) {
      if (idSet.has(point.id as PointId)) {
        result.push({ id: point.id as PointId, x: point.x, y: point.y });
      }
    }
  }

  return result;
}

/**
 * Rotate selected points around an origin.
 */
export class RotatePointsCommand extends BaseCommand<void> {
  readonly name = "Rotate Points";

  #pointIds: PointId[];
  #angle: number;
  #origin: Point2D;

  // Stored for undo - original positions before transform
  #originalPositions: Map<PointId, Point2D> = new Map();

  /**
   * @param pointIds - IDs of points to rotate
   * @param angle - Rotation angle in radians (positive = counter-clockwise)
   * @param origin - Center of rotation
   */
  constructor(pointIds: PointId[], angle: number, origin: Point2D) {
    super();
    this.#pointIds = [...pointIds];
    this.#angle = angle;
    this.#origin = origin;
  }

  execute(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;

    // Get current points from snapshot
    const points = getPointsFromSnapshot(ctx.snapshot, this.#pointIds);
    if (points.length === 0) return;

    // Store original positions for undo (only on first execute)
    if (this.#originalPositions.size === 0) {
      for (const p of points) {
        this.#originalPositions.set(p.id, { x: p.x, y: p.y });
      }
    }

    // Calculate new positions
    const transformed = TransformService.rotatePoints(
      points,
      this.#angle,
      this.#origin,
    );

    // Apply transforms
    for (const p of transformed) {
      ctx.fontEngine.editing.movePointTo(p.id, p.x, p.y);
    }
  }

  undo(ctx: CommandContext): void {
    // Restore original positions
    for (const [id, pos] of this.#originalPositions) {
      ctx.fontEngine.editing.movePointTo(id, pos.x, pos.y);
    }
  }

  redo(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;

    // Re-apply rotation from original positions
    const points: TransformablePoint[] = [];
    for (const [id, pos] of this.#originalPositions) {
      points.push({ id, x: pos.x, y: pos.y });
    }

    const transformed = TransformService.rotatePoints(
      points,
      this.#angle,
      this.#origin,
    );

    for (const p of transformed) {
      ctx.fontEngine.editing.movePointTo(p.id, p.x, p.y);
    }
  }
}

/**
 * Scale selected points from an origin.
 */
export class ScalePointsCommand extends BaseCommand<void> {
  readonly name = "Scale Points";

  #pointIds: PointId[];
  #sx: number;
  #sy: number;
  #origin: Point2D;

  #originalPositions: Map<PointId, Point2D> = new Map();

  /**
   * @param pointIds - IDs of points to scale
   * @param sx - Scale factor X
   * @param sy - Scale factor Y
   * @param origin - Center of scaling
   */
  constructor(pointIds: PointId[], sx: number, sy: number, origin: Point2D) {
    super();
    this.#pointIds = [...pointIds];
    this.#sx = sx;
    this.#sy = sy;
    this.#origin = origin;
  }

  execute(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;

    const points = getPointsFromSnapshot(ctx.snapshot, this.#pointIds);
    if (points.length === 0) return;

    // Store original positions for undo
    if (this.#originalPositions.size === 0) {
      for (const p of points) {
        this.#originalPositions.set(p.id, { x: p.x, y: p.y });
      }
    }

    const transformed = TransformService.scalePoints(
      points,
      this.#sx,
      this.#sy,
      this.#origin,
    );

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

    const transformed = TransformService.scalePoints(
      points,
      this.#sx,
      this.#sy,
      this.#origin,
    );

    for (const p of transformed) {
      ctx.fontEngine.editing.movePointTo(p.id, p.x, p.y);
    }
  }
}

/**
 * Reflect (mirror) selected points across an axis.
 */
export class ReflectPointsCommand extends BaseCommand<void> {
  readonly name = "Reflect Points";

  #pointIds: PointId[];
  #axis: ReflectAxis;
  #origin: Point2D;

  #originalPositions: Map<PointId, Point2D> = new Map();

  /**
   * @param pointIds - IDs of points to reflect
   * @param axis - Axis of reflection
   * @param origin - Point the axis passes through
   */
  constructor(pointIds: PointId[], axis: ReflectAxis, origin: Point2D) {
    super();
    this.#pointIds = [...pointIds];
    this.#axis = axis;
    this.#origin = origin;
  }

  execute(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;

    const points = getPointsFromSnapshot(ctx.snapshot, this.#pointIds);
    if (points.length === 0) return;

    // Store original positions for undo
    if (this.#originalPositions.size === 0) {
      for (const p of points) {
        this.#originalPositions.set(p.id, { x: p.x, y: p.y });
      }
    }

    const transformed = TransformService.reflectPoints(
      points,
      this.#axis,
      this.#origin,
    );

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

    const transformed = TransformService.reflectPoints(
      points,
      this.#axis,
      this.#origin,
    );

    for (const p of transformed) {
      ctx.fontEngine.editing.movePointTo(p.id, p.x, p.y);
    }
  }
}

/**
 * Apply an arbitrary transformation matrix to points.
 * Useful for compound transforms or custom operations.
 */
export class TransformMatrixCommand extends BaseCommand<void> {
  readonly name = "Transform Points";

  #pointIds: PointId[];
  #matrix: {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
  };
  #origin: Point2D;

  #originalPositions: Map<PointId, Point2D> = new Map();

  constructor(
    pointIds: PointId[],
    matrix: { a: number; b: number; c: number; d: number; e: number; f: number },
    origin: Point2D,
  ) {
    super();
    this.#pointIds = [...pointIds];
    this.#matrix = { ...matrix };
    this.#origin = origin;
  }

  execute(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;

    const points = getPointsFromSnapshot(ctx.snapshot, this.#pointIds);
    if (points.length === 0) return;

    if (this.#originalPositions.size === 0) {
      for (const p of points) {
        this.#originalPositions.set(p.id, { x: p.x, y: p.y });
      }
    }

    const transformed = TransformService.applyMatrix(
      points,
      this.#matrix,
      this.#origin,
    );

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

    const transformed = TransformService.applyMatrix(
      points,
      this.#matrix,
      this.#origin,
    );

    for (const p of transformed) {
      ctx.fontEngine.editing.movePointTo(p.id, p.x, p.y);
    }
  }
}
