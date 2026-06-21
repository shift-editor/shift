import type { PointId } from "@shift/types";
import type { Point2D } from "@shift/geo";
import type { Command, CommandContext } from "../core/Command";
import type { ReflectAxis } from "@/types/transform";

/**
 * Rotates selected points by a given angle (radians) around an origin.
 * Used by the rotate handle on the bounding box and keyboard shortcuts.
 */
export class RotatePointsCommand implements Command<void> {
  readonly name = "Rotate Points";

  readonly #pointIds: PointId[];
  readonly #angle: number;
  readonly #origin: Point2D;

  constructor(pointIds: PointId[], angle: number, origin: Point2D) {
    this.#pointIds = [...pointIds];
    this.#angle = angle;
    this.#origin = origin;
  }

  execute(ctx: CommandContext): void {
    ctx.layer.rotate(this.#pointIds, this.#angle, this.#origin);
  }
}

/**
 * Scales selected points by independent x/y factors relative to an origin.
 * Drives bounding-box resize handles.
 */
export class ScalePointsCommand implements Command<void> {
  readonly name = "Scale Points";

  readonly #pointIds: PointId[];
  readonly #sx: number;
  readonly #sy: number;
  readonly #origin: Point2D;

  constructor(pointIds: PointId[], sx: number, sy: number, origin: Point2D) {
    this.#pointIds = [...pointIds];
    this.#sx = sx;
    this.#sy = sy;
    this.#origin = origin;
  }

  execute(ctx: CommandContext): void {
    ctx.layer.scale(this.#pointIds, this.#sx, this.#sy, this.#origin);
  }
}

/**
 * Mirrors selected points across a horizontal or vertical axis through an
 * origin. Used for flip-horizontal / flip-vertical menu actions.
 */
export class ReflectPointsCommand implements Command<void> {
  readonly name = "Reflect Points";

  readonly #pointIds: PointId[];
  readonly #axis: ReflectAxis;
  readonly #origin: Point2D;

  constructor(pointIds: PointId[], axis: ReflectAxis, origin: Point2D) {
    this.#pointIds = [...pointIds];
    this.#axis = axis;
    this.#origin = origin;
  }

  execute(ctx: CommandContext): void {
    ctx.layer.reflect(this.#pointIds, this.#axis, this.#origin);
  }
}

/**
 * Translates selected points so that a given anchor position lands on a
 * target position. Computes the delta internally. Used for move-to-position
 * and alignment workflows where the destination is absolute.
 */
export class MoveSelectionToCommand implements Command<void> {
  readonly name = "Move Selection To";

  readonly #pointIds: PointId[];
  readonly #target: Point2D;
  readonly #anchor: Point2D;

  constructor(pointIds: PointId[], target: Point2D, anchor: Point2D) {
    this.#pointIds = [...pointIds];
    this.#target = target;
    this.#anchor = anchor;
  }

  execute(ctx: CommandContext): void {
    ctx.layer.moveSelectionTo(this.#pointIds, this.#target, this.#anchor);
  }
}
