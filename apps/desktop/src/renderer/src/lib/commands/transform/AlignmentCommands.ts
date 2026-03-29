import type { Point2D, PointId, GlyphSnapshot } from "@shift/types";
import { Bounds } from "@shift/geo";
import { Glyphs } from "@shift/font";
import { BaseCommand, type CommandContext } from "../core/Command";
import { Alignment } from "../../transform/Alignment";
import type { TransformablePoint, AlignmentType, DistributeType } from "@/types/transform";
import type { NodePositionUpdate } from "@/types/positionUpdate";

/**
 * Resolves point ids against a glyph snapshot, returning lightweight
 * {@link TransformablePoint} objects suitable for alignment math.
 * Returns an empty array if the snapshot is null or no ids match.
 */
function getPointsFromSnapshot(
  snapshot: GlyphSnapshot | null,
  pointIds: PointId[],
): TransformablePoint[] {
  if (!snapshot) return [];
  return Glyphs.findPoints(snapshot, pointIds).map((p) => ({
    id: p.id,
    x: p.x,
    y: p.y,
  }));
}

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
  #alignedPositions: Map<PointId, Point2D> = new Map();

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
    if (this.#alignedPositions.size === 0) {
      for (const p of aligned) {
        this.#alignedPositions.set(p.id, { x: p.x, y: p.y });
      }
    }
    ctx.fontEngine.editing.setNodePositions(toPointUpdates(aligned));
  }

  undo(ctx: CommandContext): void {
    ctx.fontEngine.editing.setNodePositions(toMapUpdates(this.#originalPositions));
  }

  override redo(ctx: CommandContext): void {
    if (this.#alignedPositions.size > 0) {
      ctx.fontEngine.editing.setNodePositions(toMapUpdates(this.#alignedPositions));
      return;
    }

    const points = mapToTransformablePoints(this.#originalPositions);
    const bounds = Bounds.fromPoints(points);
    if (!bounds) return;

    ctx.fontEngine.editing.setNodePositions(
      toPointUpdates(Alignment.alignPoints(points, this.#alignment, bounds)),
    );
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
  #distributedPositions: Map<PointId, Point2D> = new Map();

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
    if (this.#distributedPositions.size === 0) {
      for (const p of distributed) {
        this.#distributedPositions.set(p.id, { x: p.x, y: p.y });
      }
    }
    ctx.fontEngine.editing.setNodePositions(toPointUpdates(distributed));
  }

  undo(ctx: CommandContext): void {
    ctx.fontEngine.editing.setNodePositions(toMapUpdates(this.#originalPositions));
  }

  override redo(ctx: CommandContext): void {
    if (this.#distributedPositions.size > 0) {
      ctx.fontEngine.editing.setNodePositions(toMapUpdates(this.#distributedPositions));
      return;
    }

    ctx.fontEngine.editing.setNodePositions(
      toPointUpdates(
        Alignment.distributePoints(mapToTransformablePoints(this.#originalPositions), this.#type),
      ),
    );
  }
}

function toPointUpdates(points: readonly TransformablePoint[]): NodePositionUpdate[] {
  return points.map((point) => ({
    node: { kind: "point", id: point.id },
    x: point.x,
    y: point.y,
  }));
}

function toMapUpdates(positions: ReadonlyMap<PointId, Point2D>): NodePositionUpdate[] {
  const updates: NodePositionUpdate[] = [];
  for (const [id, pos] of positions) {
    updates.push({
      node: { kind: "point", id },
      x: pos.x,
      y: pos.y,
    });
  }
  return updates;
}

function mapToTransformablePoints(positions: ReadonlyMap<PointId, Point2D>): TransformablePoint[] {
  const points: TransformablePoint[] = [];
  for (const [id, pos] of positions) {
    points.push({ id, x: pos.x, y: pos.y });
  }
  return points;
}
