/**
 * EditingManager - Handles point and contour operations.
 *
 * All mutations to glyph geometry go through this manager.
 */

import type {
  PointTypeString,
  CommandResult,
  GlyphSnapshot,
} from "@/types/generated";
import type { PointId, ContourId } from "@/types/ids";
import { asPointId, asContourId } from "@/types/ids";
import type { NativeFontEngine } from "./native";
import { NoEditSessionError, NativeOperationError } from "./errors";

export interface ManagerContext {
  native: NativeFontEngine;
  hasSession: () => boolean;
  emitSnapshot: (snapshot: GlyphSnapshot | null) => void;
}

/**
 * Parse a CommandResult JSON string from Rust.
 */
function parseCommandResult(json: string): CommandResult {
  const raw = JSON.parse(json);
  return {
    success: raw.success,
    snapshot: raw.snapshot ?? null,
    error: raw.error ?? null,
    affectedPointIds: raw.affectedPointIds ?? null,
    canUndo: raw.canUndo ?? false,
    canRedo: raw.canRedo ?? false,
  };
}

/**
 * EditingManager handles all point and contour mutations.
 */
export class EditingManager {
  #ctx: ManagerContext;

  constructor(ctx: ManagerContext) {
    this.#ctx = ctx;
  }

  // ═══════════════════════════════════════════════════════════
  // POINT OPERATIONS
  // ═══════════════════════════════════════════════════════════

  /**
   * Add a point to the active contour.
   * @returns The ID of the newly added point.
   */
  addPoint(
    x: number,
    y: number,
    pointType: PointTypeString,
    smooth: boolean = false,
  ): PointId {
    this.#requireSession();

    const resultJson = this.#ctx.native.addPoint(x, y, pointType, smooth);
    const result = parseCommandResult(resultJson);

    if (!result.success) {
      throw new NativeOperationError("addPoint", result.error ?? undefined);
    }

    if (result.snapshot) {
      this.#ctx.emitSnapshot(result.snapshot);
    }

    // Return the ID of the newly added point
    const pointId = result.affectedPointIds?.[0];
    if (!pointId) {
      // Fallback: get ID from the last point of the last contour
      const lastContour =
        result.snapshot?.contours[result.snapshot.contours.length - 1];
      const lastPoint = lastContour?.points[lastContour.points.length - 1];
      return asPointId(lastPoint?.id ?? "");
    }

    return asPointId(pointId);
  }

  /**
   * Add a point to a specific contour.
   * @returns The ID of the newly added point.
   */
  addPointToContour(
    contourId: ContourId,
    x: number,
    y: number,
    pointType: PointTypeString,
    smooth: boolean = false,
  ): PointId {
    this.#requireSession();

    const resultJson = this.#ctx.native.addPointToContour(
      contourId,
      x,
      y,
      pointType,
      smooth,
    );
    const result = parseCommandResult(resultJson);

    if (!result.success) {
      throw new NativeOperationError(
        "addPointToContour",
        result.error ?? undefined,
      );
    }

    if (result.snapshot) {
      this.#ctx.emitSnapshot(result.snapshot);
    }

    const pointId = result.affectedPointIds?.[0];
    return asPointId(pointId ?? "");
  }

  /**
   * Move multiple points by a delta.
   * @returns The IDs of points that were actually moved.
   */
  movePoints(pointIds: PointId[], dx: number, dy: number): PointId[] {
    this.#requireSession();

    if (pointIds.length === 0) {
      return [];
    }

    const resultJson = this.#ctx.native.movePoints(pointIds, dx, dy);
    const result = parseCommandResult(resultJson);

    if (!result.success) {
      throw new NativeOperationError("movePoints", result.error ?? undefined);
    }

    if (result.snapshot) {
      this.#ctx.emitSnapshot(result.snapshot);
    }

    return (result.affectedPointIds ?? []).map(asPointId);
  }

  /**
   * Move a single point to an absolute position.
   * Calculates delta from current position and uses movePoints.
   */
  movePointTo(pointId: PointId, x: number, y: number): void {
    this.#requireSession();

    const snapshotJson = this.#ctx.native.getSnapshot();
    if (!snapshotJson) {
      throw new NativeOperationError("movePointTo", "No snapshot available");
    }

    const snapshot = JSON.parse(snapshotJson) as GlyphSnapshot;
    for (const contour of snapshot.contours) {
      const point = contour.points.find((p) => p.id === pointId);
      if (point) {
        const dx = x - point.x;
        const dy = y - point.y;
        this.movePoints([pointId], dx, dy);
        return;
      }
    }

    throw new NativeOperationError("movePointTo", `Point ${pointId} not found`);
  }

  /**
   * Remove multiple points.
   */
  removePoints(pointIds: PointId[]): void {
    this.#requireSession();

    if (pointIds.length === 0) {
      return;
    }

    const resultJson = this.#ctx.native.removePoints(pointIds);
    const result = parseCommandResult(resultJson);

    if (!result.success) {
      throw new NativeOperationError("removePoints", result.error ?? undefined);
    }

    if (result.snapshot) {
      this.#ctx.emitSnapshot(result.snapshot);
    }
  }

  /**
   * Insert a point before an existing point.
   * Used for inserting control points in the correct position for bezier curves.
   * @returns The ID of the newly inserted point.
   */
  insertPointBefore(
    beforePointId: PointId,
    x: number,
    y: number,
    pointType: PointTypeString,
    smooth: boolean = false,
  ): PointId {
    this.#requireSession();

    const resultJson = this.#ctx.native.insertPointBefore(
      beforePointId,
      x,
      y,
      pointType,
      smooth,
    );
    const result = parseCommandResult(resultJson);

    if (!result.success) {
      throw new NativeOperationError(
        "insertPointBefore",
        result.error ?? undefined,
      );
    }

    if (result.snapshot) {
      this.#ctx.emitSnapshot(result.snapshot);
    }

    const pointId = result.affectedPointIds?.[0];
    return asPointId(pointId ?? "");
  }

  // ═══════════════════════════════════════════════════════════
  // CONTOUR OPERATIONS
  // ═══════════════════════════════════════════════════════════

  /**
   * Add an empty contour and set it as active.
   * @returns The ID of the new contour.
   */
  addContour(): ContourId {
    this.#requireSession();

    const resultJson = this.#ctx.native.addContour();
    const result = parseCommandResult(resultJson);

    if (!result.success) {
      throw new NativeOperationError("addContour", result.error ?? undefined);
    }

    if (result.snapshot) {
      this.#ctx.emitSnapshot(result.snapshot);
    }

    // Return the active contour ID (which is the new one)
    return asContourId(result.snapshot?.activeContourId ?? "");
  }

  /**
   * Close the active contour.
   */
  closeContour(): void {
    this.#requireSession();

    const resultJson = this.#ctx.native.closeContour();
    const result = parseCommandResult(resultJson);

    if (!result.success) {
      throw new NativeOperationError("closeContour", result.error ?? undefined);
    }

    if (result.snapshot) {
      this.#ctx.emitSnapshot(result.snapshot);
    }
  }

  /**
   * Get the currently active contour ID, or null if none.
   */
  getActiveContourId(): ContourId | null {
    if (!this.#ctx.hasSession()) {
      return null;
    }

    const id = this.#ctx.native.getActiveContourId();
    return id ? asContourId(id) : null;
  }

  /**
   * Set the active contour by ID.
   */
  setActiveContour(contourId: ContourId): void {
    this.#requireSession();

    const resultJson = this.#ctx.native.setActiveContour(contourId);
    const result = parseCommandResult(resultJson);

    if (!result.success) {
      throw new NativeOperationError(
        "setActiveContour",
        result.error ?? undefined,
      );
    }

    if (result.snapshot) {
      this.#ctx.emitSnapshot(result.snapshot);
    }
  }

  /**
   * Reverse the points in a contour.
   */
  reverseContour(contourId: ContourId): void {
    this.#requireSession();

    const resultJson = this.#ctx.native.reverseContour(contourId);
    const result = parseCommandResult(resultJson);

    if (!result.success) {
      throw new NativeOperationError(
        "reverseContour",
        result.error ?? undefined,
      );
    }

    if (result.snapshot) {
      this.#ctx.emitSnapshot(result.snapshot);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // POINT PROPERTIES
  // ═══════════════════════════════════════════════════════════

  /**
   * Toggle the smooth property of a point.
   */
  toggleSmooth(pointId: PointId): void {
    this.#requireSession();

    const resultJson = this.#ctx.native.toggleSmooth(pointId);
    const result = parseCommandResult(resultJson);

    if (!result.success) {
      throw new NativeOperationError("toggleSmooth", result.error ?? undefined);
    }

    if (result.snapshot) {
      this.#ctx.emitSnapshot(result.snapshot);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVATE
  // ═══════════════════════════════════════════════════════════

  #requireSession(): void {
    if (!this.#ctx.hasSession()) {
      throw new NoEditSessionError();
    }
  }
}
