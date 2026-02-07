import type { Point2D, PointId, GlyphSnapshot } from "@shift/types";
import { Bounds } from "@shift/geo";
import { findPointsInSnapshot } from "@/lib/utils/snapshot";
import { BaseCommand, type CommandContext } from "../core/Command";
import { Alignment } from "../../transform/Alignment";
import type { TransformablePoint, AlignmentType, DistributeType } from "@/types/transform";

function getPointsFromSnapshot(
  snapshot: GlyphSnapshot | null,
  pointIds: PointId[],
): TransformablePoint[] {
  if (!snapshot) return [];
  return findPointsInSnapshot(snapshot, pointIds).map((p) => ({
    id: p.id,
    x: p.x,
    y: p.y,
  }));
}

export class AlignPointsCommand extends BaseCommand<void> {
  readonly name: string;

  #pointIds: PointId[];
  #alignment: AlignmentType;
  #originalPositions: Map<PointId, Point2D> = new Map();

  constructor(pointIds: PointId[], alignment: AlignmentType) {
    super();
    this.#pointIds = [...pointIds];
    this.#alignment = alignment;
    this.name = `Align ${alignment}`;
  }

  execute(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;

    const points = getPointsFromSnapshot(ctx.glyph, this.#pointIds);
    if (points.length === 0) return;

    if (this.#originalPositions.size === 0) {
      for (const p of points) {
        this.#originalPositions.set(p.id, { x: p.x, y: p.y });
      }
    }

    const bounds = Bounds.fromPoints(points);
    if (!bounds) return;

    const aligned = Alignment.alignPoints(points, this.#alignment, bounds);
    for (const p of aligned) {
      ctx.fontEngine.editing.movePointTo(p.id, p.x, p.y);
    }
  }

  undo(ctx: CommandContext): void {
    for (const [id, pos] of this.#originalPositions) {
      ctx.fontEngine.editing.movePointTo(id, pos.x, pos.y);
    }
  }

  redo(ctx: CommandContext): void {
    const points: TransformablePoint[] = [];
    for (const [id, pos] of this.#originalPositions) {
      points.push({ id, x: pos.x, y: pos.y });
    }

    const bounds = Bounds.fromPoints(points);
    if (!bounds) return;

    const aligned = Alignment.alignPoints(points, this.#alignment, bounds);
    for (const p of aligned) {
      ctx.fontEngine.editing.movePointTo(p.id, p.x, p.y);
    }
  }
}

export class DistributePointsCommand extends BaseCommand<void> {
  readonly name: string;

  #pointIds: PointId[];
  #type: DistributeType;
  #originalPositions: Map<PointId, Point2D> = new Map();

  constructor(pointIds: PointId[], type: DistributeType) {
    super();
    this.#pointIds = [...pointIds];
    this.#type = type;
    this.name = `Distribute ${type}`;
  }

  execute(ctx: CommandContext): void {
    if (this.#pointIds.length < 3) return;

    const points = getPointsFromSnapshot(ctx.glyph, this.#pointIds);
    if (points.length < 3) return;

    if (this.#originalPositions.size === 0) {
      for (const p of points) {
        this.#originalPositions.set(p.id, { x: p.x, y: p.y });
      }
    }

    const distributed = Alignment.distributePoints(points, this.#type);
    for (const p of distributed) {
      ctx.fontEngine.editing.movePointTo(p.id, p.x, p.y);
    }
  }

  undo(ctx: CommandContext): void {
    for (const [id, pos] of this.#originalPositions) {
      ctx.fontEngine.editing.movePointTo(id, pos.x, pos.y);
    }
  }

  redo(ctx: CommandContext): void {
    const points: TransformablePoint[] = [];
    for (const [id, pos] of this.#originalPositions) {
      points.push({ id, x: pos.x, y: pos.y });
    }

    const distributed = Alignment.distributePoints(points, this.#type);
    for (const p of distributed) {
      ctx.fontEngine.editing.movePointTo(p.id, p.x, p.y);
    }
  }
}
