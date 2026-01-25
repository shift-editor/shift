/**
 * Bezier curve manipulation commands.
 *
 * These commands handle bezier-specific operations like adding
 * anchor points with control handles and converting point types.
 */

import type { PointId, ContourId, PointType, Point2D } from "@shift/types";
import { asPointId } from "@shift/types";
import { BaseCommand, type CommandContext } from "../core/Command";
import { Curve, type CubicCurve, type QuadraticCurve } from "@shift/geo";
import type { Segment, QuadSegment, CubicSegment } from "@/types/segments";
import { Segment as SegmentOps } from "@/lib/geo/Segment";

/**
 * Insert a point before an existing point in a contour.
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
    this.#resultId = ctx.fontEngine.editing.insertPointBefore(
      this.#beforePointId,
      this.#x,
      this.#y,
      this.#pointType,
      this.#smooth,
    );
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
 * Add a bezier anchor point with symmetric control handles.
 *
 * Creates three points:
 * 1. Trailing control (opposite direction of drag)
 * 2. Anchor point (on-curve)
 * 3. Leading control (direction of drag)
 *
 * Note: Currently adds trailing AFTER anchor due to API limitation.
 * When insertPointAt is available in Rust, this should insert
 * trailing BEFORE anchor for correct bezier segment ordering.
 */
export class AddBezierAnchorCommand extends BaseCommand<PointId> {
  readonly name = "Add Bezier Anchor";

  #anchorX: number;
  #anchorY: number;
  #leadingX: number;
  #leadingY: number;

  // Calculated trailing position (mirror of leading across anchor)
  #trailingX: number;
  #trailingY: number;

  // Stored for undo
  #anchorId: PointId | null = null;
  #leadingId: PointId | null = null;
  #trailingId: PointId | null = null;

  constructor(
    anchorX: number,
    anchorY: number,
    leadingX: number,
    leadingY: number,
  ) {
    super();
    this.#anchorX = anchorX;
    this.#anchorY = anchorY;
    this.#leadingX = leadingX;
    this.#leadingY = leadingY;

    // Calculate trailing control (mirror of leading across anchor)
    this.#trailingX = 2 * anchorX - leadingX;
    this.#trailingY = 2 * anchorY - leadingY;
  }

  execute(ctx: CommandContext): PointId {
    // Add anchor point (smooth = true for bezier curves)
    this.#anchorId = ctx.fontEngine.editing.addPoint(
      this.#anchorX,
      this.#anchorY,
      "onCurve",
      true,
    );

    // Add leading control point (in drag direction)
    this.#leadingId = ctx.fontEngine.editing.addPoint(
      this.#leadingX,
      this.#leadingY,
      "offCurve",
      false,
    );

    // TODO: When insertPointAt is available, insert trailing BEFORE anchor
    // For now, we add it after which creates incorrect segment ordering
    // This is a known limitation that will be fixed with the Rust API update
    this.#trailingId = ctx.fontEngine.editing.addPoint(
      this.#trailingX,
      this.#trailingY,
      "offCurve",
      false,
    );

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

  /** Get the anchor point ID after execution */
  get anchorId(): PointId | null {
    return this.#anchorId;
  }

  /** Get the leading control ID after execution */
  get leadingId(): PointId | null {
    return this.#leadingId;
  }

  /** Get the trailing control ID after execution */
  get trailingId(): PointId | null {
    return this.#trailingId;
  }
}

/**
 * Convert a point between corner (sharp) and smooth types.
 *
 * Smooth points maintain tangent continuity with adjacent control points.
 * Corner points can have discontinuous tangents.
 */
export class TogglePointSmoothCommand extends BaseCommand<void> {
  readonly name = "Toggle Point Smooth";

  #pointId: PointId;
  // Will be used when FontEngine API is available
  #_wasSmooth: boolean | null = null;

  constructor(pointId: PointId) {
    super();
    this.#pointId = pointId;
  }

  execute(ctx: CommandContext): void {
    // Find current smooth state
    if (ctx.glyph) {
      for (const contour of ctx.glyph.contours) {
        const point = contour.points.find((p) => p.id === this.#pointId);
        if (point) {
          this.#_wasSmooth = point.smooth;
          break;
        }
      }
    }

    // TODO: Add toggleSmooth to FontEngine API
    // For now this is a placeholder
    console.warn(
      "TogglePointSmoothCommand: FontEngine.toggleSmooth not yet implemented",
    );
  }

  undo(_ctx: CommandContext): void {
    // Restore original smooth state
    // TODO: Implement when FontEngine API is available
    // Will use this.#_wasSmooth to restore the original state
    void this.#_wasSmooth;
  }
}

/**
 * Close an open contour.
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

    // Check if already closed
    if (ctx.glyph && this.#contourId) {
      const contour = ctx.glyph.contours.find(
        (c) => c.id === this.#contourId,
      );
      this.#wasClosed = contour?.closed ?? false;
    }

    if (!this.#wasClosed) {
      ctx.fontEngine.editing.closeContour();
    }
  }

  undo(_ctx: CommandContext): void {
    // TODO: Add openContour to FontEngine API to reverse this
    // For now, closing is not easily reversible
    console.warn(
      "CloseContourCommand.undo: Opening closed contour not yet supported",
    );
  }
}

/**
 * Add a new empty contour and make it active.
 */
export class AddContourCommand extends BaseCommand<ContourId> {
  readonly name = "Add Contour";

  #newContourId: ContourId | null = null;
  // Will be used when removeContour API is available
  #_previousActiveId: ContourId | null = null;

  execute(ctx: CommandContext): ContourId {
    this.#_previousActiveId = ctx.fontEngine.editing.getActiveContourId();
    this.#newContourId = ctx.fontEngine.editing.addContour();
    return this.#newContourId;
  }

  undo(_ctx: CommandContext): void {
    // TODO: Add removeContour to FontEngine API
    // Will use this.#_previousActiveId to restore the active contour
    // For now this is a placeholder
    void this.#_previousActiveId;
    console.warn("AddContourCommand.undo: Remove contour not yet implemented");
  }
}

/**
 * Nudge selected points by a small delta.
 * Typically triggered by arrow keys.
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
    ctx.fontEngine.editing.movePoints(this.#pointIds, this.#dx, this.#dy);
  }

  undo(ctx: CommandContext): void {
    if (this.#pointIds.length === 0) return;
    ctx.fontEngine.editing.movePoints(this.#pointIds, -this.#dx, -this.#dy);
  }
}

/**
 * Set the active contour.
 * Used when continuing an existing contour.
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
 * Reverse the points in a contour.
 * Used when continuing from the start of a contour.
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
 * Split a curve segment at a given parameter t.
 *
 * Uses De Casteljau's algorithm to split the curve and inserts
 * the resulting control points into the contour.
 *
 * For a cubic curve: anchor1 → control1 → control2 → anchor2
 * After split at t:  anchor1 → c0A → c1A → mid → c0B → c1B → anchor2
 *
 * For a quadratic curve: anchor1 → control → anchor2
 * After split at t:      anchor1 → cA → mid → cB → anchor2
 *
 * For a line: anchor1 → anchor2
 * After split: anchor1 → mid → anchor2
 */
export class SplitSegmentCommand extends BaseCommand<PointId> {
  readonly name = "Split Segment";

  #segment: Segment;
  #t: number;

  // Store inserted point IDs for undo
  #insertedPointIds: PointId[] = [];
  // Store original positions of moved control points for undo
  #originalPositions: Map<PointId, Point2D> = new Map();
  // The new on-curve point ID (the split point)
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

    // For a line, just insert the midpoint before anchor2
    const anchor2Id = asPointId(this.#segment.points.anchor2.id);

    this.#splitPointId = ctx.fontEngine.editing.insertPointBefore(
      anchor2Id,
      splitPoint.x,
      splitPoint.y,
      "onCurve",
      false,
    );
    this.#insertedPointIds.push(this.#splitPointId);

    return this.#splitPointId;
  }

  #splitQuadratic(ctx: CommandContext): PointId {
    const segment = this.#segment as QuadSegment;
    const curve = SegmentOps.toCurve(segment) as QuadraticCurve;
    const [curveA, curveB] = Curve.splitAt(curve, this.#t) as [
      QuadraticCurve,
      QuadraticCurve,
    ];

    // curveA = quadratic(anchor1, cA, mid)
    // curveB = quadratic(mid, cB, anchor2)
    const cA = curveA.c;
    const mid = curveA.p1; // same as curveB.p0
    const cB = curveB.c;

    const controlId = asPointId(segment.points.control.id);
    const anchor2Id = asPointId(segment.points.anchor2.id);

    // Store original control position for undo
    this.#originalPositions.set(controlId, {
      x: segment.points.control.x,
      y: segment.points.control.y,
    });

    // Insert points before anchor2 (they will be inserted in order)
    // 1. Insert mid (onCurve, smooth) before anchor2
    this.#splitPointId = ctx.fontEngine.editing.insertPointBefore(
      anchor2Id,
      mid.x,
      mid.y,
      "onCurve",
      true,
    );
    this.#insertedPointIds.push(this.#splitPointId);

    // 2. Insert cB (offCurve) before anchor2
    const cBId = ctx.fontEngine.editing.insertPointBefore(
      anchor2Id,
      cB.x,
      cB.y,
      "offCurve",
      false,
    );
    this.#insertedPointIds.push(cBId);

    // 3. Move original control to cA position
    ctx.fontEngine.editing.movePointTo(controlId, cA.x, cA.y);

    return this.#splitPointId;
  }

  #splitCubic(ctx: CommandContext): PointId {
    const segment = this.#segment as CubicSegment;
    const curve = SegmentOps.toCurve(segment) as CubicCurve;
    const [curveA, curveB] = Curve.splitAt(curve, this.#t) as [
      CubicCurve,
      CubicCurve,
    ];

    // curveA = cubic(anchor1, c0A, c1A, mid)
    // curveB = cubic(mid, c0B, c1B, anchor2)
    const c0A = curveA.c0;
    const c1A = curveA.c1;
    const mid = curveA.p1; // same as curveB.p0
    const c0B = curveB.c0;
    const c1B = curveB.c1;

    const control1Id = asPointId(segment.points.control1.id);
    const control2Id = asPointId(segment.points.control2.id);

    // Store original control positions for undo
    this.#originalPositions.set(control1Id, {
      x: segment.points.control1.x,
      y: segment.points.control1.y,
    });
    this.#originalPositions.set(control2Id, {
      x: segment.points.control2.x,
      y: segment.points.control2.y,
    });

    // Insert new points before control2 (so they end up in the right order)
    // Order of insertions (all before control2):
    // 1. c1A (offCurve) - will be between control1 and mid
    // 2. mid (onCurve) - the split point
    // 3. c0B (offCurve) - will be between mid and control2

    const c1AId = ctx.fontEngine.editing.insertPointBefore(
      control2Id,
      c1A.x,
      c1A.y,
      "offCurve",
      false,
    );
    this.#insertedPointIds.push(c1AId);

    this.#splitPointId = ctx.fontEngine.editing.insertPointBefore(
      control2Id,
      mid.x,
      mid.y,
      "onCurve",
      true,
    );
    this.#insertedPointIds.push(this.#splitPointId);

    const c0BId = ctx.fontEngine.editing.insertPointBefore(
      control2Id,
      c0B.x,
      c0B.y,
      "offCurve",
      false,
    );
    this.#insertedPointIds.push(c0BId);

    // Move existing control points to their new positions
    ctx.fontEngine.editing.movePointTo(control1Id, c0A.x, c0A.y);
    ctx.fontEngine.editing.movePointTo(control2Id, c1B.x, c1B.y);

    return this.#splitPointId;
  }

  undo(ctx: CommandContext): void {
    // Remove inserted points
    if (this.#insertedPointIds.length > 0) {
      ctx.fontEngine.editing.removePoints(this.#insertedPointIds);
    }

    // Restore original positions of moved control points
    for (const [pointId, pos] of this.#originalPositions) {
      ctx.fontEngine.editing.movePointTo(pointId, pos.x, pos.y);
    }
  }

  redo(ctx: CommandContext): PointId {
    // Clear previous state
    this.#insertedPointIds = [];
    this.#originalPositions.clear();
    this.#splitPointId = null;

    return this.execute(ctx);
  }

  /** Get the split point ID after execution */
  get splitPointId(): PointId | null {
    return this.#splitPointId;
  }
}
