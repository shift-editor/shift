import type { GlyphSnapshot, PointId, ContourId, Point2D } from "@shift/types";
import { asPointId, asContourId } from "@shift/types";
import { applyRules, applyMovesToGlyph } from "@shift/rules";
import { findPointInSnapshot } from "@/lib/utils/snapshot";
import { NoEditSessionError, NativeOperationError } from "./errors";
import type { PointMove } from "@shared/bridge/FontEngineAPI";
import type { EngineCore, PasteResult, PointEdit } from "@/types/engine";

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
  #engine: EngineCore;

  constructor(engine: EngineCore) {
    this.#engine = engine;
  }

  addPoint(edit: PointEdit): PointId {
    this.#requireSession();

    return this.#engine.commit(
      () => {
        const { x, y, pointType, smooth } = edit;
        return this.#engine.native.addPoint(x, y, pointType, smooth);
      },
      (result) => {
        const pointId = result.affectedPointIds[0];
        if (!pointId) {
          const lastContour = result.snapshot?.contours[result.snapshot.contours.length - 1];
          const lastPoint = lastContour?.points[lastContour.points.length - 1];
          return lastPoint.id;
        }

        return pointId;
      },
    );
  }

  addPointToContour(contourId: ContourId, edit: PointEdit): PointId {
    this.#requireSession();

    return this.#engine.commit(
      () => {
        const { x, y, pointType, smooth } = edit;
        return this.#engine.native.addPointToContour(contourId, x, y, pointType, smooth);
      },
      (result) => result.affectedPointIds[0],
    );
  }

  movePoints(pointIds: PointId[], delta: Point2D): PointId[] {
    this.#requireSession();

    if (pointIds.length === 0) {
      return [];
    }

    return this.#engine.commit(
      () => this.#engine.native.movePoints(pointIds, delta.x, delta.y),
      (result) => result.affectedPointIds,
    );
  }

  movePointTo(pointId: PointId, x: number, y: number): void {
    this.#requireSession();

    const glyph = this.#engine.getGlyph();
    if (!glyph) {
      throw new NativeOperationError("No glyph available");
    }

    const found = findPointInSnapshot(glyph, pointId);
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

    this.#engine.commit(() => this.#engine.native.removePoints(pointIds));
  }

  insertPointBefore(beforePointId: PointId, edit: PointEdit): PointId {
    this.#requireSession();

    const { x, y, pointType, smooth } = edit;
    return this.#engine.commit(
      () => this.#engine.native.insertPointBefore(beforePointId, x, y, pointType, smooth),
      (result) => result.affectedPointIds[0],
    );
  }

  addContour(): ContourId {
    this.#requireSession();

    return this.#engine.commit(
      () => this.#engine.native.addContour(),
      (result) => result.snapshot?.activeContourId,
    );
  }

  closeContour(): void {
    this.#requireSession();
    this.#engine.commit(() => this.#engine.native.closeContour());
  }

  getActiveContourId(): ContourId | null {
    if (!this.#engine.hasSession()) {
      return null;
    }

    const id = this.#engine.native.getActiveContourId();
    return id ?? null;
  }

  setActiveContour(contourId: ContourId): void {
    this.#requireSession();
    this.#engine.commit(() => this.#engine.native.setActiveContour(contourId));
  }

  clearActiveContour(): void {
    if (!this.#engine.hasSession()) {
      return;
    }

    this.#engine.commit(() => this.#engine.native.clearActiveContour());
  }

  reverseContour(contourId: ContourId): void {
    this.#requireSession();
    this.#engine.commit(() => this.#engine.native.reverseContour(contourId));
  }

  removeContour(contourId: ContourId): void {
    this.#requireSession();
    this.#engine.commit(() => this.#engine.native.removeContour(contourId));
  }

  openContour(contourId: ContourId): void {
    this.#requireSession();
    this.#engine.commit(() => this.#engine.native.openContour(contourId));
  }

  pasteContours(contoursJson: string, offsetX: number, offsetY: number): PasteResult {
    this.#requireSession();

    const resultJson = this.#engine.native.pasteContours(contoursJson, offsetX, offsetY);
    const result = parsePasteResult(resultJson);

    if (!result.success) {
      throw new NativeOperationError(result.error ?? "pasteContours failed");
    }

    const glyph = this.#engine.native.getSnapshotData() as GlyphSnapshot;
    this.#engine.emitGlyph(glyph);

    return result;
  }

  toggleSmooth(pointId: PointId): void {
    this.#requireSession();
    this.#engine.commit(() => this.#engine.native.toggleSmooth(pointId));
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
    this.#engine.native.setPointPositions(nativeMoves);

    return moves.map((m) => m.id);
  }

  setPointPositions(moves: Array<{ id: PointId; x: number; y: number }>): void {
    if (!this.#engine.hasSession()) return;
    if (moves.length === 0) return;

    const glyph = this.#engine.getGlyph();
    if (!glyph) return;

    const updatedGlyph = applyMovesToGlyph(glyph, moves);
    this.#engine.emitGlyph(updatedGlyph);

    this.#engine.native.setPointPositions(moves);
  }

  restoreSnapshot(snapshot: GlyphSnapshot): void {
    this.#requireSession();
    this.#engine.native.restoreSnapshot(snapshot);
    this.#engine.emitGlyph(snapshot);
  }

  #requireSession(): void {
    if (!this.#engine.hasSession()) {
      throw new NoEditSessionError();
    }
  }
}
