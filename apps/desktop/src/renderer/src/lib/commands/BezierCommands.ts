/**
 * Bezier curve manipulation commands.
 *
 * These commands handle bezier-specific operations like adding
 * anchor points with control handles and converting point types.
 */

import type { PointId, ContourId } from "@/types/ids";
import type { PointTypeString } from "@/types/generated";
import { BaseCommand, type CommandContext } from "./Command";

/**
 * Insert a point before an existing point in a contour.
 */
export class InsertPointCommand extends BaseCommand<PointId> {
  readonly name = "Insert Point";

  #beforePointId: PointId;
  #x: number;
  #y: number;
  #pointType: PointTypeString;
  #smooth: boolean;

  #resultId: PointId | null = null;

  constructor(
    beforePointId: PointId,
    x: number,
    y: number,
    pointType: PointTypeString,
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
    if (ctx.snapshot) {
      for (const contour of ctx.snapshot.contours) {
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
    if (ctx.snapshot && this.#contourId) {
      const contour = ctx.snapshot.contours.find(
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
