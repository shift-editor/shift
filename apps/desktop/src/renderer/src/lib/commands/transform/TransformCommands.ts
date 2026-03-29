import type { Point2D, PointId } from "@shift/types";
import { Vec2 } from "@shift/geo";
import { BaseCommand, type CommandContext } from "../core/Command";
import { Transform } from "../../transform/Transform";
import type { ReflectAxis, TransformablePoint } from "@/types/transform";
import { Glyphs } from "@shift/font";
import type { NodePositionUpdate } from "@/types/positionUpdate";

/**
 * Template for point-set transform commands. Captures original positions on
 * first execute, delegates to {@link transformPoints} for the actual math,
 * and writes results back via the font engine. Subclasses only need to
 * implement `transformPoints`.
 */
abstract class BaseTransformCommand extends BaseCommand<void> {
  abstract override readonly name: string;

  #pointIds: PointId[];
  #originalPositions: Map<PointId, Point2D> = new Map();
  #transformedPositions: Map<PointId, Point2D> = new Map();

  constructor(pointIds: PointId[]) {
    super();
    this.#pointIds = [...pointIds];
  }

  protected abstract transformPoints(points: readonly TransformablePoint[]): TransformablePoint[];

  execute(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;
    if (!ctx.glyph) return;

    const points = Glyphs.findPoints(ctx.glyph, this.#pointIds);
    if (points.length === 0) return;

    if (this.#originalPositions.size === 0) {
      for (const p of points) {
        this.#originalPositions.set(p.id, { x: p.x, y: p.y });
      }
    }

    const transformed = this.transformPoints(points);
    if (this.#transformedPositions.size === 0) {
      for (const p of transformed) {
        this.#transformedPositions.set(p.id, { x: p.x, y: p.y });
      }
    }

    ctx.fontEngine.editing.setNodePositions(this.#toUpdates(transformed));
  }

  undo(ctx: CommandContext): void {
    ctx.fontEngine.editing.setNodePositions(this.#mapToUpdates(this.#originalPositions));
  }

  override redo(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;

    const points: TransformablePoint[] = [];
    for (const [id, pos] of this.#originalPositions) {
      points.push({ id, x: pos.x, y: pos.y });
    }

    if (this.#transformedPositions.size > 0) {
      ctx.fontEngine.editing.setNodePositions(this.#mapToUpdates(this.#transformedPositions));
      return;
    }

    const transformed = this.transformPoints(points);
    ctx.fontEngine.editing.setNodePositions(this.#toUpdates(transformed));
  }

  #toUpdates(points: readonly TransformablePoint[]): NodePositionUpdate[] {
    return points.map((point) => ({
      node: { kind: "point", id: point.id },
      x: point.x,
      y: point.y,
    }));
  }

  #mapToUpdates(positions: ReadonlyMap<PointId, Point2D>): NodePositionUpdate[] {
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
}

/**
 * Rotates selected points by a given angle (radians) around an origin.
 * Used by the rotate handle on the bounding box and keyboard shortcuts.
 */
export class RotatePointsCommand extends BaseTransformCommand {
  readonly name = "Rotate Points";

  #angle: number;
  #origin: Point2D;

  constructor(pointIds: PointId[], angle: number, origin: Point2D) {
    super(pointIds);
    this.#angle = angle;
    this.#origin = origin;
  }

  protected transformPoints(points: readonly TransformablePoint[]): TransformablePoint[] {
    return Transform.rotatePoints(points, this.#angle, this.#origin);
  }
}

/**
 * Scales selected points by independent x/y factors relative to an origin.
 * Drives bounding-box resize handles.
 */
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

  protected transformPoints(points: readonly TransformablePoint[]): TransformablePoint[] {
    return Transform.scalePoints(points, this.#sx, this.#sy, this.#origin);
  }
}

/**
 * Mirrors selected points across a horizontal or vertical axis through an
 * origin. Used for flip-horizontal / flip-vertical menu actions.
 */
export class ReflectPointsCommand extends BaseTransformCommand {
  readonly name = "Reflect Points";

  #axis: ReflectAxis;
  #origin: Point2D;

  constructor(pointIds: PointId[], axis: ReflectAxis, origin: Point2D) {
    super(pointIds);
    this.#axis = axis;
    this.#origin = origin;
  }

  protected transformPoints(points: readonly TransformablePoint[]): TransformablePoint[] {
    return Transform.reflectPoints(points, this.#axis, this.#origin);
  }
}

/**
 * Translates selected points so that a given anchor position lands on a
 * target position. Computes the delta internally. Used for snap-to-position
 * and alignment workflows where the destination is absolute.
 */
export class MoveSelectionToCommand extends BaseTransformCommand {
  readonly name = "Move Selection To";

  #target: Point2D;
  #anchor: Point2D;

  constructor(pointIds: PointId[], target: Point2D, anchor: Point2D) {
    super(pointIds);
    this.#target = target;
    this.#anchor = anchor;
  }

  protected transformPoints(points: readonly TransformablePoint[]): TransformablePoint[] {
    const delta = Vec2.sub(this.#target, this.#anchor);

    return points.map((p) => {
      const newPos = Vec2.add(p, delta);
      return { id: p.id, x: newPos.x, y: newPos.y };
    });
  }
}
