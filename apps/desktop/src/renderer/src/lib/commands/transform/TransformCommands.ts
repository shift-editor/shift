import type { Point2D, PointId } from "@shift/types";
import { Glyphs } from "@shift/font";
import { BaseCommand, type CommandContext } from "../core/Command";
import type { ReflectAxis } from "@/types/transform";

abstract class BaseTransformCommand extends BaseCommand<void> {
  abstract override readonly name: string;

  protected readonly pointIds: PointId[];
  #originalPositions: Map<PointId, Point2D> = new Map();

  constructor(pointIds: PointId[]) {
    super();
    this.pointIds = [...pointIds];
  }

  protected captureOriginalPositions(ctx: CommandContext): void {
    if (this.#originalPositions.size > 0 || this.pointIds.length === 0) return;

    for (const point of Glyphs.findPoints(ctx.glyph, this.pointIds)) {
      this.#originalPositions.set(point.id, { x: point.x, y: point.y });
    }
  }

  protected restoreOriginalPositions(ctx: CommandContext): void {
    for (const [id, pos] of this.#originalPositions) {
      ctx.glyph.movePointTo(id, pos);
    }
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

  execute(ctx: CommandContext): void {
    this.captureOriginalPositions(ctx);
    ctx.glyph.rotate(this.pointIds, this.#angle, this.#origin);
  }

  undo(ctx: CommandContext): void {
    this.restoreOriginalPositions(ctx);
  }

  override redo(ctx: CommandContext): void {
    ctx.glyph.rotate(this.pointIds, this.#angle, this.#origin);
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

  execute(ctx: CommandContext): void {
    this.captureOriginalPositions(ctx);
    ctx.glyph.scale(this.pointIds, this.#sx, this.#sy, this.#origin);
  }

  undo(ctx: CommandContext): void {
    this.restoreOriginalPositions(ctx);
  }

  override redo(ctx: CommandContext): void {
    ctx.glyph.scale(this.pointIds, this.#sx, this.#sy, this.#origin);
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

  execute(ctx: CommandContext): void {
    this.captureOriginalPositions(ctx);
    ctx.glyph.reflect(this.pointIds, this.#axis, this.#origin);
  }

  undo(ctx: CommandContext): void {
    this.restoreOriginalPositions(ctx);
  }

  override redo(ctx: CommandContext): void {
    ctx.glyph.reflect(this.pointIds, this.#axis, this.#origin);
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

  execute(ctx: CommandContext): void {
    this.captureOriginalPositions(ctx);
    ctx.glyph.moveSelectionTo(this.pointIds, this.#target, this.#anchor);
  }

  undo(ctx: CommandContext): void {
    this.restoreOriginalPositions(ctx);
  }

  override redo(ctx: CommandContext): void {
    ctx.glyph.moveSelectionTo(this.pointIds, this.#target, this.#anchor);
  }
}
