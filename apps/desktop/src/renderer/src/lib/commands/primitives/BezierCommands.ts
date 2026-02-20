import type { PointId, ContourId, PointType, Point2D } from "@shift/types";
import { BaseCommand, type CommandContext } from "../core/Command";
import { Curve, type CubicCurve, type QuadraticCurve } from "@shift/geo";
import type { Segment, QuadSegment, CubicSegment, LineSegment } from "@/types/segments";
import { Segment as SegmentOps } from "@/lib/geo/Segment";

/**
 * Inserts a point into an existing contour immediately before a reference point.
 * Used by the pen tool to add on-curve or off-curve points at a specific
 * position in the contour's winding order. Undo removes the inserted point.
 */
export class InsertPointCommand extends BaseCommand<PointId> {
  readonly name = "Insert Point";

  #beforePointId: PointId;
  #x: number;
  #y: number;
  #pointType: PointType;
  #smooth: boolean;

  #resultId: PointId | null = null;

  constructor(
    beforePointId: PointId,
    x: number,
    y: number,
    pointType: PointType,
    smooth: boolean = false,
  ) {
    super();
    this.#beforePointId = beforePointId;
    this.#x = x;
    this.#y = y;
    this.#pointType = pointType;
    this.#smooth = smooth;
  }

  execute(ctx: CommandContext): PointId {
    this.#resultId = ctx.fontEngine.editing.insertPointBefore(this.#beforePointId, {
      x: this.#x,
      y: this.#y,
      pointType: this.#pointType,
      smooth: this.#smooth,
    });
    return this.#resultId;
  }

  undo(ctx: CommandContext): void {
    if (this.#resultId) {
      ctx.fontEngine.editing.removePoints([this.#resultId]);
    }
  }

  redo(ctx: CommandContext): PointId {
    return this.execute(ctx);
  }
}

/**
 * Adds a smooth cubic anchor with symmetric leading and trailing off-curve
 * handles. The trailing handle is auto-reflected through the anchor so the
 * curve enters and exits smoothly. Returns the anchor's PointId; handle ids
 * are available via {@link anchorId}, {@link leadingId}, and {@link trailingId}.
 */
export class AddBezierAnchorCommand extends BaseCommand<PointId> {
  readonly name = "Add Bezier Anchor";

  #anchorX: number;
  #anchorY: number;
  #leadingX: number;
  #leadingY: number;

  #trailingX: number;
  #trailingY: number;

  #anchorId: PointId | null = null;
  #leadingId: PointId | null = null;
  #trailingId: PointId | null = null;

  constructor(anchorX: number, anchorY: number, leadingX: number, leadingY: number) {
    super();
    this.#anchorX = anchorX;
    this.#anchorY = anchorY;
    this.#leadingX = leadingX;
    this.#leadingY = leadingY;

    this.#trailingX = 2 * anchorX - leadingX;
    this.#trailingY = 2 * anchorY - leadingY;
  }

  execute(ctx: CommandContext): PointId {
    this.#anchorId = ctx.fontEngine.editing.addPoint({
      id: "" as PointId,
      x: this.#anchorX,
      y: this.#anchorY,
      pointType: "onCurve",
      smooth: true,
    });

    this.#leadingId = ctx.fontEngine.editing.addPoint({
      id: "" as PointId,
      x: this.#leadingX,
      y: this.#leadingY,
      pointType: "offCurve",
      smooth: false,
    });

    this.#trailingId = ctx.fontEngine.editing.addPoint({
      id: "" as PointId,
      x: this.#trailingX,
      y: this.#trailingY,
      pointType: "offCurve",
      smooth: false,
    });

    return this.#anchorId;
  }

  undo(ctx: CommandContext): void {
    const toRemove: PointId[] = [];
    if (this.#anchorId) toRemove.push(this.#anchorId);
    if (this.#leadingId) toRemove.push(this.#leadingId);
    if (this.#trailingId) toRemove.push(this.#trailingId);

    if (toRemove.length > 0) {
      ctx.fontEngine.editing.removePoints(toRemove);
    }
  }

  redo(ctx: CommandContext): PointId {
    return this.execute(ctx);
  }

  get anchorId(): PointId | null {
    return this.#anchorId;
  }

  get leadingId(): PointId | null {
    return this.#leadingId;
  }

  get trailingId(): PointId | null {
    return this.#trailingId;
  }
}

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
    this.#contourId = ctx.fontEngine.editing.getActiveContourId();

    if (ctx.glyph && this.#contourId) {
      const contour = ctx.glyph.contours.find((c) => c.id === this.#contourId);
      this.#wasClosed = contour?.closed ?? false;
    }

    if (!this.#wasClosed) {
      ctx.fontEngine.editing.closeContour();
    }
  }

  undo(ctx: CommandContext): void {
    if (this.#contourId && !this.#wasClosed) {
      ctx.fontEngine.editing.openContour(this.#contourId);
    }
  }
}

/**
 * Creates a new empty contour in the glyph and makes it active. Remembers
 * the previously active contour so undo can restore it after removing the
 * new one.
 */
export class AddContourCommand extends BaseCommand<ContourId> {
  readonly name = "Add Contour";

  #newContourId: ContourId | null = null;
  #previousActiveId: ContourId | null = null;

  execute(ctx: CommandContext): ContourId {
    this.#previousActiveId = ctx.fontEngine.editing.getActiveContourId();
    this.#newContourId = ctx.fontEngine.editing.addContour();
    return this.#newContourId;
  }

  undo(ctx: CommandContext): void {
    if (this.#newContourId) {
      ctx.fontEngine.editing.removeContour(this.#newContourId);
    }
    if (this.#previousActiveId) {
      ctx.fontEngine.editing.setActiveContour(this.#previousActiveId);
    }
  }
}

/**
 * Moves points by a fixed delta, intended for keyboard arrow-key nudging.
 * Functionally identical to {@link MovePointsCommand} but carries its own
 * command name for distinct undo history labeling.
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
    ctx.fontEngine.editing.movePoints(this.#pointIds, { x: this.#dx, y: this.#dy });
  }

  undo(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;
    ctx.fontEngine.editing.movePoints(this.#pointIds, { x: -this.#dx, y: -this.#dy });
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
    this.#previousActiveId = ctx.fontEngine.editing.getActiveContourId();
    ctx.fontEngine.editing.setActiveContour(this.#contourId);
  }

  undo(ctx: CommandContext): void {
    if (this.#previousActiveId) {
      ctx.fontEngine.editing.setActiveContour(this.#previousActiveId);
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
    ctx.fontEngine.editing.reverseContour(this.#contourId);
  }

  undo(ctx: CommandContext): void {
    ctx.fontEngine.editing.reverseContour(this.#contourId);
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

    this.#splitPointId = ctx.fontEngine.editing.insertPointBefore(anchor2Id, {
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

    this.#splitPointId = ctx.fontEngine.editing.insertPointBefore(anchor2Id, {
      id: "" as PointId,
      x: mid.x,
      y: mid.y,
      pointType: "onCurve",
      smooth: true,
    });
    this.#insertedPointIds.push(this.#splitPointId);

    const cBId = ctx.fontEngine.editing.insertPointBefore(anchor2Id, {
      id: "" as PointId,
      x: cB.x,
      y: cB.y,
      pointType: "offCurve",
      smooth: false,
    });
    this.#insertedPointIds.push(cBId);

    ctx.fontEngine.editing.movePointTo(controlId, cA.x, cA.y);

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

    const c1AId = ctx.fontEngine.editing.insertPointBefore(control2Id, {
      x: c1A.x,
      y: c1A.y,
      pointType: "offCurve",
      smooth: false,
    });
    this.#insertedPointIds.push(c1AId);

    this.#splitPointId = ctx.fontEngine.editing.insertPointBefore(control2Id, {
      x: mid.x,
      y: mid.y,
      pointType: "onCurve",
      smooth: true,
    });
    this.#insertedPointIds.push(this.#splitPointId);

    const c0BId = ctx.fontEngine.editing.insertPointBefore(control2Id, {
      x: c0B.x,
      y: c0B.y,
      pointType: "offCurve",
      smooth: false,
    });
    this.#insertedPointIds.push(c0BId);

    ctx.fontEngine.editing.movePointTo(control1Id, c0A.x, c0A.y);
    ctx.fontEngine.editing.movePointTo(control2Id, c1B.x, c1B.y);

    return this.#splitPointId;
  }

  undo(ctx: CommandContext): void {
    if (this.#insertedPointIds.length > 0) {
      ctx.fontEngine.editing.removePoints(this.#insertedPointIds);
    }

    for (const [pointId, pos] of this.#originalPositions) {
      ctx.fontEngine.editing.movePointTo(pointId, pos.x, pos.y);
    }
  }

  redo(ctx: CommandContext): PointId {
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
    this.#control2Id = ctx.fontEngine.editing.insertPointBefore(this.#anchor2Id, {
      x: this.#control2Pos.x,
      y: this.#control2Pos.y,
      pointType: "offCurve",
      smooth: false,
    });
    this.#control1Id = ctx.fontEngine.editing.insertPointBefore(this.#control2Id, {
      x: this.#control1Pos.x,
      y: this.#control1Pos.y,
      pointType: "offCurve",
      smooth: false,
    });
  }

  undo(ctx: CommandContext): void {
    const toRemove = [this.#control1Id, this.#control2Id].filter(Boolean) as PointId[];
    if (toRemove.length > 0) {
      ctx.fontEngine.editing.removePoints(toRemove);
    }
  }

  redo(ctx: CommandContext): void {
    this.#control1Id = null;
    this.#control2Id = null;
    this.execute(ctx);
  }
}
