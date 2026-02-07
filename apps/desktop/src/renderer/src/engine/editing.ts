import type { GlyphSnapshot, PointId, ContourId, Point2D } from "@shift/types";
import { applyRules, applyMovesToGlyph } from "@shift/rules";
import { ValidateSnapshot } from "@shift/validation";
import { Glyphs } from "@shift/font";
import { NoEditSessionError, NativeOperationError } from "./errors";
import type { PointMove } from "@shared/bridge/FontEngineAPI";
import type { EngineCore, PasteResult, PointEdit } from "@/types/engine";
import { ContourContent } from "@/lib/clipboard";

export class EditingManager {
  #engine: EngineCore;

  constructor(engine: EngineCore) {
    this.#engine = engine;
  }

  addPoint(edit: PointEdit): PointId {
    this.#requireSession();

    const response = this.#engine.addPoint(edit.x, edit.y, edit.pointType, edit.smooth);
    this.#engine.emitGlyph(response.snapshot);

    const pointId = response.affectedPointIds[0];
    if (!pointId) {
      const lastContour = response.snapshot.contours[response.snapshot.contours.length - 1];
      const lastPoint = lastContour?.points[lastContour.points.length - 1];
      return lastPoint.id;
    }

    return pointId;
  }

  addPointToContour(contourId: ContourId, edit: PointEdit): PointId {
    this.#requireSession();

    const response = this.#engine.addPointToContour(
      contourId,
      edit.x,
      edit.y,
      edit.pointType,
      edit.smooth,
    );
    this.#engine.emitGlyph(response.snapshot);
    return response.affectedPointIds[0];
  }

  movePoints(pointIds: PointId[], delta: Point2D): PointId[] {
    this.#requireSession();

    if (pointIds.length === 0) {
      return [];
    }

    const response = this.#engine.movePoints(pointIds, delta.x, delta.y);
    this.#engine.emitGlyph(response.snapshot);
    return response.affectedPointIds;
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
    this.#requireSession();

    if (pointIds.length === 0) {
      return;
    }

    const response = this.#engine.removePoints(pointIds);
    this.#engine.emitGlyph(response.snapshot);
  }

  insertPointBefore(beforePointId: PointId, edit: PointEdit): PointId {
    this.#requireSession();

    const { x, y, pointType, smooth } = edit;
    const response = this.#engine.insertPointBefore(beforePointId, x, y, pointType, smooth);
    this.#engine.emitGlyph(response.snapshot);
    return response.affectedPointIds[0];
  }

  addContour(): ContourId {
    this.#requireSession();

    const response = this.#engine.addContour();
    this.#engine.emitGlyph(response.snapshot);
    return response.snapshot.activeContourId!;
  }

  closeContour(): void {
    this.#requireSession();
    const response = this.#engine.closeContour();
    this.#engine.emitGlyph(response.snapshot);
  }

  getActiveContourId(): ContourId | null {
    if (!this.#engine.hasSession()) {
      return null;
    }

    return this.#engine.getActiveContourId();
  }

  setActiveContour(contourId: ContourId): void {
    this.#requireSession();
    const response = this.#engine.setActiveContour(contourId);
    this.#engine.emitGlyph(response.snapshot);
  }

  clearActiveContour(): void {
    if (!this.#engine.hasSession()) {
      return;
    }

    const response = this.#engine.clearActiveContour();
    this.#engine.emitGlyph(response.snapshot);
  }

  reverseContour(contourId: ContourId): void {
    this.#requireSession();
    const response = this.#engine.reverseContour(contourId);
    this.#engine.emitGlyph(response.snapshot);
  }

  removeContour(contourId: ContourId): void {
    this.#requireSession();
    const response = this.#engine.removeContour(contourId);
    this.#engine.emitGlyph(response.snapshot);
  }

  openContour(contourId: ContourId): void {
    this.#requireSession();
    const response = this.#engine.openContour(contourId);
    this.#engine.emitGlyph(response.snapshot);
  }

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

  toggleSmooth(pointId: PointId): void {
    this.#requireSession();
    const response = this.#engine.toggleSmooth(pointId);
    this.#engine.emitGlyph(response.snapshot);
  }

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

  setPointPositions(moves: Array<{ id: PointId; x: number; y: number }>): void {
    if (!this.#engine.hasSession()) return;
    if (moves.length === 0) return;

    const glyph = this.#engine.getGlyph();
    if (!glyph) return;

    const updatedGlyph = applyMovesToGlyph(glyph, moves);
    this.#engine.emitGlyph(updatedGlyph);

    this.#engine.setPointPositions(moves);
  }

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
