import type { Point2D, PointId } from "@shift/types";
import { BaseCommand, type CommandContext } from "../core/Command";
import type { AlignmentType, DistributeType } from "@/types/transform";

/**
 * Aligns selected points along one edge or center of the selection's own
 * bounding box (not the glyph bounds). Supports left, right, top, bottom,
 * horizontal center, and vertical center. Captures original positions for undo.
 */
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

    const points = ctx.glyph.findPoints(this.#pointIds);
    if (points.length === 0) return;

    if (this.#originalPositions.size === 0) {
      for (const p of points) {
        this.#originalPositions.set(p.id, { x: p.x, y: p.y });
      }
    }

    ctx.glyph.align(this.#pointIds, this.#alignment);
  }

  undo(ctx: CommandContext): void {
    for (const [id, pos] of this.#originalPositions) {
      ctx.glyph.movePointTo(id, pos);
    }
  }

  override redo(ctx: CommandContext): void {
    ctx.glyph.align(this.#pointIds, this.#alignment);
  }
}

/**
 * Evenly distributes selected points along the horizontal or vertical axis.
 * Requires at least 3 points; the outermost points remain fixed while inner
 * points are spaced equally between them. Captures original positions for undo.
 */
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

    const points = ctx.glyph.findPoints(this.#pointIds);
    if (points.length < 3) return;

    if (this.#originalPositions.size === 0) {
      for (const p of points) {
        this.#originalPositions.set(p.id, { x: p.x, y: p.y });
      }
    }

    ctx.glyph.distribute(this.#pointIds, this.#type);
  }

  undo(ctx: CommandContext): void {
    for (const [id, pos] of this.#originalPositions) {
      ctx.glyph.movePointTo(id, pos);
    }
  }

  override redo(ctx: CommandContext): void {
    ctx.glyph.distribute(this.#pointIds, this.#type);
  }
}
