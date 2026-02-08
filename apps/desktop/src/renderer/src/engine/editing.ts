import type { GlyphSnapshot, PointId, ContourId, Point2D } from "@shift/types";
import { applyRules, applyMovesToGlyph } from "@shift/rules";
import { ValidateSnapshot } from "@shift/validation";
import { Glyphs } from "@shift/font";
import { NoEditSessionError, NativeOperationError } from "./errors";
import type { PointMove } from "@shared/bridge/FontEngineAPI";
import type { EngineCore, CommandResponse, PasteResult, PointEdit } from "@/types/engine";
import { ContourContent } from "@/lib/clipboard";

export class EditingManager {
  #engine: EngineCore;

  constructor(engine: EngineCore) {
    this.#engine = engine;
  }

  #execute(json: string): CommandResponse {
    const raw = JSON.parse(json);
    if (!raw.success) {
      throw new NativeOperationError(raw.error ?? "Unknown native error");
    }
    return { snapshot: raw.snapshot, affectedPointIds: raw.affectedPointIds };
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
