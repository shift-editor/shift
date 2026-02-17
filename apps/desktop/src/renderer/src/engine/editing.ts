import type { GlyphSnapshot, PointId, ContourId, Point2D, AnchorId } from "@shift/types";
import { applyRules, applyMovesToGlyph } from "@shift/rules";
import { ValidateSnapshot } from "@shift/validation";
import { Glyphs } from "@shift/font";
import { NoEditSessionError, NativeOperationError } from "./errors";
import type { FontEngineAPI, PointMove, AnchorMove } from "@shared/bridge/FontEngineAPI";
import type { CommandResponse, PasteResult, PointEdit } from "@/types/engine";
import { ContourContent } from "@/lib/clipboard";

/** Raw NAPI surface that {@link EditingManager} wraps. Provides bridge access, session guards, glyph read/write, and low-level mutation primitives. */
export interface EditingEngineDeps {
  readonly raw: FontEngineAPI;
  hasSession(): boolean;
  getGlyph(): GlyphSnapshot | null;
  emitGlyph(glyph: GlyphSnapshot | null): void;
  getActiveContourId(): ContourId | null;
  getSnapshot(): GlyphSnapshot;
  restoreSnapshot(snapshot: GlyphSnapshot): void;
  setPointPositions(moves: PointMove[]): boolean;
  setAnchorPositions(moves: AnchorMove[]): boolean;
  pasteContours(contoursJson: string, offsetX: number, offsetY: number): PasteResult;
}

function applyAnchorMovesToGlyph(
  glyph: GlyphSnapshot,
  moves: Array<{ id: AnchorId; x: number; y: number }>,
): GlyphSnapshot {
  if (moves.length === 0) return glyph;

  const moveById = new Map<string, { x: number; y: number }>();
  for (const move of moves) {
    moveById.set(move.id, { x: move.x, y: move.y });
  }

  return {
    ...glyph,
    anchors: glyph.anchors.map((anchor) => {
      const move = moveById.get(anchor.id);
      if (!move) return anchor;
      return { ...anchor, x: move.x, y: move.y };
    }),
  };
}

/**
 * All glyph mutations flow through this manager.
 *
 * Every public method guards on an active session, then dispatches via one of three internal helpers:
 * - `#execute` -- parses the JSON command response and throws on failure
 * - `#dispatch` -- executes, emits the snapshot, and returns affected point IDs
 * - `#dispatchVoid` -- executes and emits, discarding the ID list
 */
export class EditingManager {
  #engine: EditingEngineDeps;

  constructor(engine: EditingEngineDeps) {
    this.#engine = engine;
  }

  #execute(json: string): CommandResponse {
    const raw = JSON.parse(json);
    if (!raw.success) {
      throw new NativeOperationError(raw.error ?? "Unknown native error");
    }
    if (!raw.snapshot) {
      throw new NativeOperationError("Native operation succeeded but returned no snapshot");
    }
    return {
      snapshot: raw.snapshot as GlyphSnapshot,
      affectedPointIds: raw.affectedPointIds,
    };
  }

  #dispatch(json: string): PointId[] {
    this.#requireSession();
    const response = this.#execute(json);
    this.#engine.emitGlyph(response.snapshot);
    return response.affectedPointIds;
  }

  #dispatchVoid(json: string): void {
    this.#requireSession();
    const response = this.#execute(json);
    this.#engine.emitGlyph(response.snapshot);
  }

  addPoint(edit: PointEdit): PointId {
    const ids = this.#dispatch(
      this.#engine.raw.addPoint(edit.x, edit.y, edit.pointType, edit.smooth),
    );

    const pointId = ids[0];
    if (!pointId) {
      const glyph = this.#engine.getGlyph()!;
      const lastContour = glyph.contours[glyph.contours.length - 1];
      const lastPoint = lastContour?.points[lastContour.points.length - 1];
      return lastPoint.id;
    }

    return pointId;
  }

  addPointToContour(contourId: ContourId, edit: PointEdit): PointId {
    const ids = this.#dispatch(
      this.#engine.raw.addPointToContour(contourId, edit.x, edit.y, edit.pointType, edit.smooth),
    );
    return ids[0];
  }

  movePoints(pointIds: PointId[], delta: Point2D): PointId[] {
    if (pointIds.length === 0) return [];
    return this.#dispatch(this.#engine.raw.movePoints(pointIds, delta.x, delta.y));
  }

  moveAnchors(anchorIds: AnchorId[], delta: Point2D): void {
    if (anchorIds.length === 0) return;
    this.#dispatchVoid(this.#engine.raw.moveAnchors(anchorIds, delta.x, delta.y));
  }

  movePointTo(pointId: PointId, x: number, y: number): void {
    this.#requireSession();

    const glyph = this.#engine.getGlyph();
    if (!glyph) {
      throw new NativeOperationError("No glyph available");
    }

    const found = Glyphs.findPoint(glyph, pointId);
    if (!found) {
      throw new NativeOperationError(`Point ${pointId} not found`);
    }
    this.movePoints([pointId], { x: x - found.point.x, y: y - found.point.y });
  }

  removePoints(pointIds: PointId[]): void {
    if (pointIds.length === 0) return;
    this.#dispatchVoid(this.#engine.raw.removePoints(pointIds));
  }

  insertPointBefore(beforePointId: PointId, edit: PointEdit): PointId {
    const ids = this.#dispatch(
      this.#engine.raw.insertPointBefore(
        beforePointId,
        edit.x,
        edit.y,
        edit.pointType,
        edit.smooth,
      ),
    );
    return ids[0];
  }

  toggleSmooth(pointId: PointId): void {
    this.#dispatchVoid(this.#engine.raw.toggleSmooth(pointId));
  }

  addContour(): ContourId {
    this.#requireSession();
    const response = this.#execute(this.#engine.raw.addContour());
    this.#engine.emitGlyph(response.snapshot);
    return response.snapshot.activeContourId!;
  }

  closeContour(): void {
    this.#dispatchVoid(this.#engine.raw.closeContour());
  }

  getActiveContourId(): ContourId | null {
    if (!this.#engine.hasSession()) return null;
    return this.#engine.getActiveContourId();
  }

  setXAdvance(width: number): void {
    this.#dispatchVoid(this.#engine.raw.setXAdvance(width));
  }

  translateLayer(dx: number, dy: number): void {
    this.#dispatchVoid(this.#engine.raw.translateLayer(dx, dy));
  }

  setActiveContour(contourId: ContourId): void {
    this.#dispatchVoid(this.#engine.raw.setActiveContour(contourId));
  }

  clearActiveContour(): void {
    if (!this.#engine.hasSession()) return;
    this.#dispatchVoid(this.#engine.raw.clearActiveContour());
  }

  reverseContour(contourId: ContourId): void {
    this.#dispatchVoid(this.#engine.raw.reverseContour(contourId));
  }

  removeContour(contourId: ContourId): void {
    this.#dispatchVoid(this.#engine.raw.removeContour(contourId));
  }

  openContour(contourId: ContourId): void {
    this.#dispatchVoid(this.#engine.raw.openContour(contourId));
  }

  /** Returns {@link PasteResult} containing the IDs of all newly created points and contours. Offset is in UPM units. */
  pasteContours(contours: ContourContent[], offsetX: number, offsetY: number): PasteResult {
    this.#requireSession();

    const contoursJson = JSON.stringify(contours);
    const result = this.#engine.pasteContours(contoursJson, offsetX, offsetY);

    if (!result.success) {
      throw new NativeOperationError(result.error ?? "pasteContours failed");
    }

    const snapshot = this.#engine.getSnapshot();
    this.#engine.emitGlyph(snapshot);

    return result;
  }

  /**
   * Runs the rules engine on selected points, applies resulting moves optimistically
   * to the glyph signal, then syncs absolute positions to native. Returns affected IDs.
   */
  applySmartEdits(selectedPoints: ReadonlySet<PointId>, dx: number, dy: number): PointId[] {
    if (!this.#engine.hasSession()) return [];

    const glyph = this.#engine.getGlyph();
    if (!glyph) return [];

    const { moves } = applyRules(glyph, selectedPoints, dx, dy);
    if (moves.length === 0) return [];

    const updatedGlyph = applyMovesToGlyph(glyph, moves);
    this.#engine.emitGlyph(updatedGlyph);

    const nativeMoves: PointMove[] = moves.map((m) => ({
      id: m.id,
      x: m.x,
      y: m.y,
    }));
    this.#engine.setPointPositions(nativeMoves);

    return moves.map((m) => m.id);
  }

  /** Batch-sets absolute positions. Applies optimistically to the signal, then syncs to native. */
  setPointPositions(moves: Array<{ id: PointId; x: number; y: number }>): void {
    if (!this.#engine.hasSession()) return;
    if (moves.length === 0) return;

    const glyph = this.#engine.getGlyph();
    if (!glyph) return;

    const updatedGlyph = applyMovesToGlyph(glyph, moves);
    this.#engine.emitGlyph(updatedGlyph);

    this.#engine.setPointPositions(moves);
  }

  /** Batch-sets absolute anchor positions. Applies optimistically to the signal, then syncs to native. */
  setAnchorPositions(moves: Array<{ id: AnchorId; x: number; y: number }>): void {
    if (!this.#engine.hasSession()) return;
    if (moves.length === 0) return;

    const glyph = this.#engine.getGlyph();
    if (!glyph) return;

    const updatedGlyph = applyAnchorMovesToGlyph(glyph, moves);
    this.#engine.emitGlyph(updatedGlyph);

    this.#engine.setAnchorPositions(moves);
  }

  /** Validates and restores a previous snapshot. Throws on invalid data. Used for undo/redo. */
  restoreSnapshot(snapshot: GlyphSnapshot): void {
    this.#requireSession();
    if (!ValidateSnapshot.isGlyphSnapshot(snapshot)) {
      throw new NativeOperationError("Cannot restore invalid snapshot");
    }
    this.#engine.restoreSnapshot(snapshot);
    this.#engine.emitGlyph(snapshot);
  }

  #requireSession(): void {
    if (!this.#engine.hasSession()) {
      throw new NoEditSessionError();
    }
  }
}
