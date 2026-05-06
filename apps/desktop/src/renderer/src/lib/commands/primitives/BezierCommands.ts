import type { PointId, ContourId } from "@shift/types";
import { BaseCommand, type CommandContext } from "../core/Command";
import { Point2D, type CubicCurve, type QuadraticCurve } from "@shift/geo";
import type { LineSegment, Segment } from "@shift/glyph-state";

/**
 * Closes the active contour, connecting the last point back to the first.
 * No-ops if the contour is already closed. Undo reopens the contour only
 * if this command actually closed it.
 */
export class CloseContourCommand extends BaseCommand<void> {
  readonly name = "Close Contour";

  #contourId: ContourId;
  #wasClosed: boolean = false;

  constructor(contourId: ContourId) {
    super();
    this.#contourId = contourId;
  }

  execute(ctx: CommandContext): void {
    const contour = ctx.source.contour(this.#contourId);
    if (!contour) throw new Error("Expected contour");

    this.#wasClosed = contour.closed;

    if (!this.#wasClosed) {
      ctx.source.closeContour(this.#contourId);
    }
  }

  undo(ctx: CommandContext): void {
    if (!this.#wasClosed) {
      ctx.source.openContour(this.#contourId);
    }
  }
}

/**
 * Moves points by a fixed delta, intended for keyboard arrow-key nudging.
 * Uses setNodePositions (Float64Array path) instead of movePoints to avoid
 * per-struct NAPI marshaling + full snapshot round-trip.
 */
export class NudgePointsCommand extends BaseCommand<void> {
  readonly name = "Nudge Points";

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
    this.#apply(ctx, this.#dx, this.#dy);
  }

  undo(ctx: CommandContext): void {
    this.#apply(ctx, -this.#dx, -this.#dy);
  }

  #apply(ctx: CommandContext, dx: number, dy: number): void {
    if (this.#pointIds.length === 0) return;

    ctx.source.translate(this.#pointIds, { x: dx, y: dy });
  }
}

/**
 * Reverses a contour's winding direction. This affects fill rule rendering
 * (e.g. counter-shapes) and path direction conventions. The operation is
 * self-inverse, so undo simply reverses again.
 */
export class ReverseContourCommand extends BaseCommand<void> {
  readonly name = "Reverse Contour";

  #contourId: ContourId;

  constructor(contourId: ContourId) {
    super();
    this.#contourId = contourId;
  }

  execute(ctx: CommandContext): void {
    ctx.source.reverseContour(this.#contourId);
  }

  undo(ctx: CommandContext): void {
    ctx.source.reverseContour(this.#contourId);
  }
}

/**
 * Splits a segment at parametric value t, inserting new points and adjusting
 * control handles to preserve the curve's shape. Handles line, quadratic, and
 * cubic segments using de Casteljau subdivision. Returns the id of the new
 * on-curve split point. Undo removes inserted points and restores original
 * control positions.
 */
export class SplitSegmentCommand extends BaseCommand<PointId> {
  readonly name = "Split Segment";

  #segment: Segment;
  #t: number;

  #insertedPointIds: PointId[] = [];
  #originalPositions: Map<PointId, Point2D> = new Map();
  #splitPointId: PointId | null = null;

  constructor(segment: Segment, t: number) {
    super();
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

    const anchor2Id = this.#segment.anchor2.id;

    this.#splitPointId = ctx.source.insertPointBefore(anchor2Id, {
      x: splitPoint.x,
      y: splitPoint.y,
      pointType: "onCurve",
      smooth: false,
    });
    this.#insertedPointIds.push(this.#splitPointId);

    return this.#splitPointId;
  }

  #splitQuadratic(ctx: CommandContext): PointId {
    const data = this.#segment.asQuad()!;
    const [curveA, curveB] = this.#segment.splitAt(this.#t) as [QuadraticCurve, QuadraticCurve];

    const cA = curveA.c;
    const mid = curveA.p1;
    const cB = curveB.c;

    const controlId = data.points.control.id;
    const anchor2Id = data.points.anchor2.id;

    this.#originalPositions.set(controlId, {
      x: data.points.control.x,
      y: data.points.control.y,
    });

    this.#splitPointId = ctx.source.insertPointBefore(anchor2Id, {
      x: mid.x,
      y: mid.y,
      pointType: "onCurve",
      smooth: true,
    });
    this.#insertedPointIds.push(this.#splitPointId);

    const cBId = ctx.source.insertPointBefore(anchor2Id, {
      x: cB.x,
      y: cB.y,
      pointType: "offCurve",
      smooth: false,
    });
    this.#insertedPointIds.push(cBId);

    ctx.source.movePointTo(controlId, cA);

    return this.#splitPointId;
  }

  #splitCubic(ctx: CommandContext): PointId {
    const data = this.#segment.asCubic()!;
    const [curveA, curveB] = this.#segment.splitAt(this.#t) as [CubicCurve, CubicCurve];

    const c0A = curveA.c0;
    const c1A = curveA.c1;
    const mid = curveA.p1;
    const c0B = curveB.c0;
    const c1B = curveB.c1;

    const control1Id = data.points.control1.id;
    const control2Id = data.points.control2.id;

    this.#originalPositions.set(control1Id, {
      x: data.points.control1.x,
      y: data.points.control1.y,
    });
    this.#originalPositions.set(control2Id, {
      x: data.points.control2.x,
      y: data.points.control2.y,
    });

    const c1AId = ctx.source.insertPointBefore(control2Id, {
      x: c1A.x,
      y: c1A.y,
      pointType: "offCurve",
      smooth: false,
    });
    this.#insertedPointIds.push(c1AId);

    this.#splitPointId = ctx.source.insertPointBefore(control2Id, {
      x: mid.x,
      y: mid.y,
      pointType: "onCurve",
      smooth: true,
    });
    this.#insertedPointIds.push(this.#splitPointId);

    const c0BId = ctx.source.insertPointBefore(control2Id, {
      x: c0B.x,
      y: c0B.y,
      pointType: "offCurve",
      smooth: false,
    });
    this.#insertedPointIds.push(c0BId);

    ctx.source.movePointTo(control1Id, c0A);
    ctx.source.movePointTo(control2Id, c1B);

    return this.#splitPointId;
  }

  undo(ctx: CommandContext): void {
    if (this.#insertedPointIds.length > 0) {
      ctx.source.removePoints(this.#insertedPointIds);
    }

    for (const [pointId, pos] of this.#originalPositions) {
      ctx.source.movePointTo(pointId, pos);
    }
  }

  override redo(ctx: CommandContext): PointId {
    this.#insertedPointIds = [];
    this.#originalPositions.clear();
    this.#splitPointId = null;

    return this.execute(ctx);
  }

  get splitPointId(): PointId | null {
    return this.#splitPointId;
  }
}

/**
 * Converts a line segment into a cubic bezier by inserting two off-curve
 * control points at the 1/3 and 2/3 positions. The resulting cubic traces
 * the same path as the original line, enabling subsequent handle manipulation
 * to introduce curvature. Undo removes the inserted control points.
 */
export class UpgradeLineToCubicCommand extends BaseCommand<void> {
  readonly name = "Upgrade Line to Cubic";

  #anchor2Id: PointId;
  #control1Pos: Point2D;
  #control2Pos: Point2D;
  #control1Id: PointId | null = null;
  #control2Id: PointId | null = null;

  constructor(segment: LineSegment) {
    super();
    const p1 = segment.points.anchor1;
    const p2 = segment.points.anchor2;
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
    this.#control2Id = ctx.source.insertPointBefore(this.#anchor2Id, {
      x: this.#control2Pos.x,
      y: this.#control2Pos.y,
      pointType: "offCurve",
      smooth: false,
    });
    this.#control1Id = ctx.source.insertPointBefore(this.#control2Id, {
      x: this.#control1Pos.x,
      y: this.#control1Pos.y,
      pointType: "offCurve",
      smooth: false,
    });
  }

  undo(ctx: CommandContext): void {
    const toRemove = [this.#control1Id, this.#control2Id].filter(Boolean) as PointId[];
    if (toRemove.length > 0) {
      ctx.source.removePoints(toRemove);
    }
  }

  override redo(ctx: CommandContext): void {
    this.#control1Id = null;
    this.#control2Id = null;
    this.execute(ctx);
  }
}
