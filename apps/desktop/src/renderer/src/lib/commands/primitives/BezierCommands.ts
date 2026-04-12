import type { PointId, ContourId, Point2D } from "@shift/types";
import { Glyphs } from "@shift/font";
import { BaseCommand, type CommandContext } from "../core/Command";
import { Curve, type CubicCurve, type QuadraticCurve } from "@shift/geo";
import type { Segment, QuadSegment, CubicSegment, LineSegment } from "@/types/segments";
import { Segments as SegmentOps } from "@/lib/geo/Segments";

/**
 * Closes the active contour, connecting the last point back to the first.
 * No-ops if the contour is already closed. Undo reopens the contour only
 * if this command actually closed it.
 */
export class CloseContourCommand extends BaseCommand<void> {
  readonly name = "Close Contour";

  #contourId: ContourId | null = null;
  #wasClosed: boolean = false;

  constructor() {
    super();
  }

  execute(ctx: CommandContext): void {
    this.#contourId = ctx.glyph.activeContourId;

    if (this.#contourId) {
      const contour = Glyphs.findContour(ctx.glyph, this.#contourId);
      this.#wasClosed = contour?.closed ?? false;
    }

    if (!this.#wasClosed) {
      ctx.glyph.closeContour();
    }
  }

  undo(ctx: CommandContext): void {
    if (this.#contourId && !this.#wasClosed) {
      ctx.glyph.openContour(this.#contourId);
    }
  }
}

/**
 * Moves points by a fixed delta, intended for keyboard arrow-key nudging.
 * Moves points by a fixed delta, intended for keyboard arrow-key nudging.
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
    if (this.#pointIds.length === 0) return;
    ctx.glyph.movePoints(this.#pointIds, { x: this.#dx, y: this.#dy });
  }

  undo(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;
    ctx.glyph.movePoints(this.#pointIds, { x: -this.#dx, y: -this.#dy });
  }
}

/**
 * Switches the active contour in the font engine. New points are appended
 * to the active contour, so this controls where subsequent drawing lands.
 * Undo restores the previously active contour.
 */
export class SetActiveContourCommand extends BaseCommand<void> {
  readonly name = "Set Active Contour";

  #contourId: ContourId;
  #previousActiveId: ContourId | null = null;

  constructor(contourId: ContourId) {
    super();
    this.#contourId = contourId;
  }

  execute(ctx: CommandContext): void {
    this.#previousActiveId = ctx.glyph.activeContourId;
    ctx.glyph.setActiveContour(this.#contourId);
  }

  undo(ctx: CommandContext): void {
    if (this.#previousActiveId) {
      ctx.glyph.setActiveContour(this.#previousActiveId);
    }
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
    ctx.glyph.reverseContour(this.#contourId);
  }

  undo(ctx: CommandContext): void {
    ctx.glyph.reverseContour(this.#contourId);
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
    const curve = SegmentOps.toCurve(this.#segment);
    const splitPoint = Curve.pointAt(curve, this.#t);

    const anchor2Id = this.#segment.points.anchor2.id;

    this.#splitPointId = ctx.glyph.insertPointBefore(anchor2Id, {
      x: splitPoint.x,
      y: splitPoint.y,
      pointType: "onCurve",
      smooth: false,
    });
    this.#insertedPointIds.push(this.#splitPointId);

    return this.#splitPointId;
  }

  #splitQuadratic(ctx: CommandContext): PointId {
    const segment = this.#segment as QuadSegment;
    const curve = SegmentOps.toCurve(segment) as QuadraticCurve;
    const [curveA, curveB] = Curve.splitAt(curve, this.#t) as [QuadraticCurve, QuadraticCurve];

    const cA = curveA.c;
    const mid = curveA.p1;
    const cB = curveB.c;

    const controlId = segment.points.control.id;
    const anchor2Id = segment.points.anchor2.id;

    this.#originalPositions.set(controlId, {
      x: segment.points.control.x,
      y: segment.points.control.y,
    });

    this.#splitPointId = ctx.glyph.insertPointBefore(anchor2Id, {
      x: mid.x,
      y: mid.y,
      pointType: "onCurve",
      smooth: true,
    });
    this.#insertedPointIds.push(this.#splitPointId);

    const cBId = ctx.glyph.insertPointBefore(anchor2Id, {
      x: cB.x,
      y: cB.y,
      pointType: "offCurve",
      smooth: false,
    });
    this.#insertedPointIds.push(cBId);

    ctx.glyph.movePointTo(controlId, cA.x, cA.y);

    return this.#splitPointId;
  }

  #splitCubic(ctx: CommandContext): PointId {
    const segment = this.#segment as CubicSegment;
    const curve = SegmentOps.toCurve(segment) as CubicCurve;
    const [curveA, curveB] = Curve.splitAt(curve, this.#t) as [CubicCurve, CubicCurve];

    const c0A = curveA.c0;
    const c1A = curveA.c1;
    const mid = curveA.p1;
    const c0B = curveB.c0;
    const c1B = curveB.c1;

    const control1Id = segment.points.control1.id;
    const control2Id = segment.points.control2.id;

    this.#originalPositions.set(control1Id, {
      x: segment.points.control1.x,
      y: segment.points.control1.y,
    });
    this.#originalPositions.set(control2Id, {
      x: segment.points.control2.x,
      y: segment.points.control2.y,
    });

    const c1AId = ctx.glyph.insertPointBefore(control2Id, {
      x: c1A.x,
      y: c1A.y,
      pointType: "offCurve",
      smooth: false,
    });
    this.#insertedPointIds.push(c1AId);

    this.#splitPointId = ctx.glyph.insertPointBefore(control2Id, {
      x: mid.x,
      y: mid.y,
      pointType: "onCurve",
      smooth: true,
    });
    this.#insertedPointIds.push(this.#splitPointId);

    const c0BId = ctx.glyph.insertPointBefore(control2Id, {
      x: c0B.x,
      y: c0B.y,
      pointType: "offCurve",
      smooth: false,
    });
    this.#insertedPointIds.push(c0BId);

    ctx.glyph.movePointTo(control1Id, c0A.x, c0A.y);
    ctx.glyph.movePointTo(control2Id, c1B.x, c1B.y);

    return this.#splitPointId;
  }

  undo(ctx: CommandContext): void {
    if (this.#insertedPointIds.length > 0) {
      ctx.glyph.removePoints(this.#insertedPointIds);
    }

    for (const [pointId, pos] of this.#originalPositions) {
      ctx.glyph.movePointTo(pointId, pos.x, pos.y);
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
    this.#control2Id = ctx.glyph.insertPointBefore(this.#anchor2Id, {
      x: this.#control2Pos.x,
      y: this.#control2Pos.y,
      pointType: "offCurve",
      smooth: false,
    });
    this.#control1Id = ctx.glyph.insertPointBefore(this.#control2Id, {
      x: this.#control1Pos.x,
      y: this.#control1Pos.y,
      pointType: "offCurve",
      smooth: false,
    });
  }

  undo(ctx: CommandContext): void {
    const toRemove = [this.#control1Id, this.#control2Id].filter(Boolean) as PointId[];
    if (toRemove.length > 0) {
      ctx.glyph.removePoints(toRemove);
    }
  }

  override redo(ctx: CommandContext): void {
    this.#control1Id = null;
    this.#control2Id = null;
    this.execute(ctx);
  }
}
