/**
 * EditingManager - Handles point and contour operations.
 *
 * All mutations to glyph geometry go through this manager.
 */

import type { PointType, GlyphSnapshot, PointId, ContourId, MatchedRule } from "@shift/types";
import { asPointId, asContourId } from "@shift/types";
import { applyRules, applyMovesToGlyph } from "@shift/rules";
import { NoEditSessionError, NativeOperationError } from "./errors";
import type { CommitContext } from "./FontEngine";
import type { PointMove } from "@/shared/bridge/FontEngineAPI";

interface SmartEditResult {
  success: boolean;
  snapshot: GlyphSnapshot | null;
  affectedPointIds: string[];
  matchedRules: MatchedRule[];
  error: string | null;
}

export type ManagerContext = CommitContext;

export interface PasteResult {
  success: boolean;
  createdPointIds: PointId[];
  createdContourIds: ContourId[];
  error?: string;
}

function parsePasteResult(json: string): PasteResult {
  const raw = JSON.parse(json);
  return {
    success: raw.success,
    createdPointIds: (raw.createdPointIds ?? []).map(asPointId),
    createdContourIds: (raw.createdContourIds ?? []).map(asContourId),
    error: raw.error ?? undefined,
  };
}

export class EditingManager {
  #ctx: ManagerContext;

  constructor(ctx: ManagerContext) {
    this.#ctx = ctx;
  }

  addPoint(x: number, y: number, pointType: PointType, smooth: boolean = false): PointId {
    this.#requireSession();

    return this.#ctx.commit(
      (result) => {
        if (!result.success) {
          throw new NativeOperationError("addPoint", result.error ?? undefined);
        }
        const pointId = result.affectedPointIds?.[0];
        if (!pointId) {
          const lastContour = result.snapshot?.contours[result.snapshot.contours.length - 1];
          const lastPoint = lastContour?.points[lastContour.points.length - 1];
          return asPointId(lastPoint?.id ?? "");
        }
        return asPointId(pointId);
      },
      () => this.#ctx.native.addPoint(x, y, pointType, smooth),
    );
  }

  addPointToContour(
    contourId: ContourId,
    x: number,
    y: number,
    pointType: PointType,
    smooth: boolean = false,
  ): PointId {
    this.#requireSession();

    return this.#ctx.commit(
      (result) => {
        if (!result.success) {
          throw new NativeOperationError("addPointToContour", result.error ?? undefined);
        }
        const pointId = result.affectedPointIds?.[0];
        return asPointId(pointId ?? "");
      },
      () => this.#ctx.native.addPointToContour(contourId, x, y, pointType, smooth),
    );
  }

  movePoints(pointIds: PointId[], dx: number, dy: number): PointId[] {
    this.#requireSession();

    if (pointIds.length === 0) {
      return [];
    }

    return this.#ctx.commit(
      (result) => {
        if (!result.success) {
          throw new NativeOperationError("movePoints", result.error ?? undefined);
        }
        return (result.affectedPointIds ?? []).map(asPointId);
      },
      () => this.#ctx.native.movePoints(pointIds, dx, dy),
    );
  }

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

  removePoints(pointIds: PointId[]): void {
    this.#requireSession();

    if (pointIds.length === 0) {
      return;
    }

    this.#ctx.commit(
      (result) => {
        if (!result.success) {
          throw new NativeOperationError("removePoints", result.error ?? undefined);
        }
      },
      () => this.#ctx.native.removePoints(pointIds),
    );
  }

  insertPointBefore(
    beforePointId: PointId,
    x: number,
    y: number,
    pointType: PointType,
    smooth: boolean = false,
  ): PointId {
    this.#requireSession();

    return this.#ctx.commit(
      (result) => {
        if (!result.success) {
          throw new NativeOperationError("insertPointBefore", result.error ?? undefined);
        }
        const pointId = result.affectedPointIds?.[0];
        return asPointId(pointId ?? "");
      },
      () => this.#ctx.native.insertPointBefore(beforePointId, x, y, pointType, smooth),
    );
  }

  addContour(): ContourId {
    this.#requireSession();

    return this.#ctx.commit(
      (result) => {
        if (!result.success) {
          throw new NativeOperationError("addContour", result.error ?? undefined);
        }
        return asContourId(result.snapshot?.activeContourId ?? "");
      },
      () => this.#ctx.native.addContour(),
    );
  }

  closeContour(): void {
    this.#requireSession();

    this.#ctx.commit(
      (result) => {
        if (!result.success) {
          throw new NativeOperationError("closeContour", result.error ?? undefined);
        }
      },
      () => this.#ctx.native.closeContour(),
    );
  }

  getActiveContourId(): ContourId | null {
    if (!this.#ctx.hasSession()) {
      return null;
    }

    const id = this.#ctx.native.getActiveContourId();
    return id ? asContourId(id) : null;
  }

  setActiveContour(contourId: ContourId): void {
    this.#requireSession();

    this.#ctx.commit(
      (result) => {
        if (!result.success) {
          throw new NativeOperationError("setActiveContour", result.error ?? undefined);
        }
      },
      () => this.#ctx.native.setActiveContour(contourId),
    );
  }

  clearActiveContour(): void {
    if (!this.#ctx.hasSession()) {
      return;
    }

    this.#ctx.commit(
      (result) => {
        if (!result.success) {
          throw new NativeOperationError("clearActiveContour", result.error ?? undefined);
        }
      },
      () => this.#ctx.native.clearActiveContour(),
    );
  }

  reverseContour(contourId: ContourId): void {
    this.#requireSession();

    this.#ctx.commit(
      (result) => {
        if (!result.success) {
          throw new NativeOperationError("reverseContour", result.error ?? undefined);
        }
      },
      () => this.#ctx.native.reverseContour(contourId),
    );
  }

  removeContour(contourId: ContourId): void {
    this.#requireSession();

    this.#ctx.commit(
      (result) => {
        if (!result.success) {
          throw new NativeOperationError("removeContour", result.error ?? undefined);
        }
      },
      () => this.#ctx.native.removeContour(contourId),
    );
  }

  openContour(contourId: ContourId): void {
    this.#requireSession();

    this.#ctx.commit(
      (result) => {
        if (!result.success) {
          throw new NativeOperationError("openContour", result.error ?? undefined);
        }
      },
      () => this.#ctx.native.openContour(contourId),
    );
  }

  pasteContours(contoursJson: string, offsetX: number, offsetY: number): PasteResult {
    this.#requireSession();

    const resultJson = this.#ctx.native.pasteContours(contoursJson, offsetX, offsetY);
    const result = parsePasteResult(resultJson);

    if (!result.success) {
      throw new NativeOperationError("pasteContours", result.error ?? undefined);
    }

    const snapshotJson = this.#ctx.native.getSnapshot();
    if (snapshotJson) {
      this.#ctx.emitGlyph(JSON.parse(snapshotJson));
    }

    return result;
  }

  toggleSmooth(pointId: PointId): void {
    this.#requireSession();

    this.#ctx.commit(
      (result) => {
        if (!result.success) {
          throw new NativeOperationError("toggleSmooth", result.error ?? undefined);
        }
      },
      () => this.#ctx.native.toggleSmooth(pointId),
    );
  }

  applySmartEdits(selectedPoints: ReadonlySet<PointId>, dx: number, dy: number): PointId[] {
    if (!this.#ctx.hasSession()) {
      return [];
    }

    const pointIds = [...selectedPoints];
    const resultJson = this.#ctx.native.applyEditsUnified(pointIds, dx, dy);
    const result: SmartEditResult = JSON.parse(resultJson);

    if (result.success && result.snapshot) {
      this.#ctx.emitGlyph(result.snapshot);
    }

    return result.affectedPointIds?.map(asPointId) ?? [];
  }

  /**
   * Apply smart edits using local TS rules engine.
   * This is the optimized version that avoids NAPI serialization overhead:
   * 1. Compute all moves locally using @shift/rules
   * 2. Apply moves to local glyph copy (immediate UI update)
   * 3. Sync positions to Rust (fire-and-forget)
   *
   * @param glyph - Current glyph snapshot
   * @param selectedPoints - Set of selected point IDs
   * @param dx - Delta X
   * @param dy - Delta Y
   * @returns Updated glyph snapshot and affected point IDs
   */
  applySmartEditsLocal(
    glyph: GlyphSnapshot,
    selectedPoints: ReadonlySet<PointId>,
    dx: number,
    dy: number
  ): { glyph: GlyphSnapshot; affectedPointIds: PointId[] } {
    if (!this.#ctx.hasSession()) {
      return { glyph, affectedPointIds: [] };
    }

    // 1. Compute all moves locally using TS rules engine
    const { moves, matchedRules } = applyRules(glyph, selectedPoints, dx, dy);

    if (moves.length === 0) {
      return { glyph, affectedPointIds: [] };
    }

    // 2. Apply moves to local glyph copy (creates new snapshot)
    const updatedGlyph = applyMovesToGlyph(glyph, moves);

    // 3. Emit updated glyph for immediate UI update
    this.#ctx.emitGlyph(updatedGlyph);

    // 4. Sync positions to Rust (fire-and-forget)
    const nativeMoves: PointMove[] = moves.map((m) => ({
      id: m.id,
      x: m.x,
      y: m.y,
    }));
    this.#ctx.native.setPointPositions(nativeMoves);

    // 5. Return affected point IDs
    const affectedPointIds = moves.map((m) => m.id);

    return { glyph: updatedGlyph, affectedPointIds };
  }

  restoreSnapshot(snapshot: GlyphSnapshot): void {
    this.#requireSession();
    // Use the native object API to avoid JSON serialization overhead.
    // The GlyphSnapshot type matches the expected native format (camelCase).
    // We cast since the types are structurally compatible.
    this.#ctx.native.restoreSnapshotNative(snapshot as import("shift-node").JsGlyphSnapshot);
    this.#ctx.emitGlyph(snapshot);
  }

  #requireSession(): void {
    if (!this.#ctx.hasSession()) {
      throw new NoEditSessionError();
    }
  }
}
