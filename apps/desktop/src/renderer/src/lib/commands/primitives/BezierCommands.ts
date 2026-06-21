import type { PointId, ContourId } from "@shift/types";
import type { Command, CommandContext } from "../core/Command";
import type { CubicCurve, QuadraticCurve, Point2D } from "@shift/geo";
import { Point, type LineSegmentPoints, type Segment } from "@shift/glyph-state";

/**
 * Moves points by a fixed delta, intended for keyboard arrow-key nudging.
 */
export class NudgePointsCommand implements Command<void> {
  readonly name = "Nudge Points";

  readonly #pointIds: PointId[];
  readonly #dx: number;
  readonly #dy: number;

  constructor(pointIds: PointId[], dx: number, dy: number) {
    this.#pointIds = [...pointIds];
    this.#dx = dx;
    this.#dy = dy;
  }

  execute(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;

    ctx.layer.movePoints(this.#pointIds, { x: this.#dx, y: this.#dy });
  }
}

/**
 * Reverses a contour's winding direction. This affects fill rule rendering
 * (e.g. counter-shapes) and path direction conventions.
 */
export class ReverseContourCommand implements Command<void> {
  readonly name = "Reverse Contour";

  readonly #contourId: ContourId;

  constructor(contourId: ContourId) {
    this.#contourId = contourId;
  }

  execute(ctx: CommandContext): void {
    ctx.layer.reverseContour(this.#contourId);
  }
}

/**
 * Splits a segment at parametric value t, inserting new points and adjusting
 * control handles to preserve the curve's shape. Handles line, quadratic, and
 * cubic segments using de Casteljau subdivision. Returns the id of the new
 * on-curve split point.
 */
export class SplitSegmentCommand implements Command<PointId> {
  readonly name = "Split Segment";

  readonly #segment: Segment;
  readonly #t: number;

  #splitPointId: PointId | null = null;

  constructor(segment: Segment, t: number) {
    this.#segment = segment;
    this.#t = t;
  }

  execute(ctx: CommandContext): PointId {
    switch (this.#segment.type) {
      case "line":
        return this.#splitLine(ctx);
      case "quad":
        return this.#splitQuadratic(ctx);
      case "cubic":
        return this.#splitCubic(ctx);
    }
  }

  #splitLine(ctx: CommandContext): PointId {
    const splitPoint = this.#segment.pointAt(this.#t);

    const anchor2Id = this.#segment.endId;

    this.#splitPointId = ctx.layer.insertPointBefore(anchor2Id, Point.onCurve(splitPoint));

    return this.#splitPointId;
  }

  #splitQuadratic(ctx: CommandContext): PointId {
    const points = this.#segment.asQuad()!;
    const [curveA, curveB] = this.#segment.splitAt(this.#t) as [QuadraticCurve, QuadraticCurve];

    const cA = curveA.c;
    const mid = curveA.p1;
    const cB = curveB.c;

    const controlId = points.control.id;
    const anchor2Id = points.end.id;

    this.#splitPointId = ctx.layer.insertPointBefore(anchor2Id, Point.smooth(mid));
    ctx.layer.insertPointBefore(anchor2Id, Point.offCurve(cB));

    ctx.layer.movePointTo(controlId, cA);

    return this.#splitPointId;
  }

  #splitCubic(ctx: CommandContext): PointId {
    const points = this.#segment.asCubic()!;
    const [curveA, curveB] = this.#segment.splitAt(this.#t) as [CubicCurve, CubicCurve];

    const c0A = curveA.c0;
    const c1A = curveA.c1;
    const mid = curveA.p1;
    const c0B = curveB.c0;
    const c1B = curveB.c1;

    const control1Id = points.controlStart.id;
    const control2Id = points.controlEnd.id;

    ctx.layer.insertPointBefore(control2Id, Point.offCurve(c1A));
    this.#splitPointId = ctx.layer.insertPointBefore(control2Id, Point.smooth(mid));
    ctx.layer.insertPointBefore(control2Id, Point.offCurve(c0B));

    ctx.layer.movePointTo(control1Id, c0A);
    ctx.layer.movePointTo(control2Id, c1B);

    return this.#splitPointId;
  }

  get splitPointId(): PointId | null {
    return this.#splitPointId;
  }
}

/**
 * Converts a line segment into a cubic bezier by inserting two off-curve
 * control points at the 1/3 and 2/3 positions. The resulting cubic traces
 * the same path as the original line, enabling subsequent handle manipulation
 * to introduce curvature.
 */
export class UpgradeLineToCubicCommand implements Command<void> {
  readonly name = "Upgrade Line to Cubic";

  readonly #anchor2Id: PointId;
  readonly #control1Pos: Point2D;
  readonly #control2Pos: Point2D;

  constructor(segment: LineSegmentPoints) {
    const p1 = segment.start;
    const p2 = segment.end;
    this.#anchor2Id = p2.id;

    this.#control1Pos = {
      x: p1.x + (p2.x - p1.x) / 3,
      y: p1.y + (p2.y - p1.y) / 3,
    };
    this.#control2Pos = {
      x: p1.x + ((p2.x - p1.x) * 2) / 3,
      y: p1.y + ((p2.y - p1.y) * 2) / 3,
    };
  }

  execute(ctx: CommandContext): void {
    const control2Id = ctx.layer.insertPointBefore(
      this.#anchor2Id,
      Point.offCurve(this.#control2Pos),
    );
    ctx.layer.insertPointBefore(control2Id, Point.offCurve(this.#control1Pos));
  }
}
