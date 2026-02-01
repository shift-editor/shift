import type { PointId, ContourId, Glyph, Contour, Point, PointType } from "@shift/types";
import { asContourId } from "@shift/types";
import type { FontEngine } from "@/engine";

export interface EditServiceDeps {
  fontEngine: FontEngine;
  getGlyph: () => Glyph | null;
  getPointById: (id: PointId) => Point | null;
  getContourById: (id: ContourId) => Contour | null;
}

export class EditService {
  #fontEngine: FontEngine;
  #getGlyph: () => Glyph | null;
  #getPointById: (id: PointId) => Point | null;
  #getContourById: (id: ContourId) => Contour | null;

  constructor(deps: EditServiceDeps) {
    this.#fontEngine = deps.fontEngine;
    this.#getGlyph = deps.getGlyph;
    this.#getPointById = deps.getPointById;
    this.#getContourById = deps.getContourById;
  }

  getGlyph(): Glyph | null {
    return this.#getGlyph();
  }

  getPointById(id: PointId): Point | null {
    return this.#getPointById(id);
  }

  getContourById(id: ContourId): Contour | null {
    return this.#getContourById(id);
  }

  addPoint(x: number, y: number, type: PointType, smooth = false): PointId {
    return this.#fontEngine.editing.addPoint(x, y, type, smooth);
  }

  addPointToContour(
    contourId: ContourId,
    x: number,
    y: number,
    type: PointType,
    smooth: boolean,
  ): PointId {
    return this.#fontEngine.editing.addPointToContour(contourId, x, y, type, smooth);
  }

  movePoints(ids: Iterable<PointId>, dx: number, dy: number): void {
    this.#fontEngine.editing.movePoints([...ids], dx, dy);
  }

  movePointTo(id: PointId, x: number, y: number): void {
    this.#fontEngine.editing.movePointTo(id, x, y);
  }

  applySmartEdits(ids: readonly PointId[], dx: number, dy: number): PointId[] {
    return this.#fontEngine.editing.applySmartEdits(new Set(ids), dx, dy);
  }

  setPointPositions(moves: Array<{ id: PointId; x: number; y: number }>): void {
    this.#fontEngine.editing.setPointPositions(moves);
  }

  removePoints(ids: Iterable<PointId>): void {
    this.#fontEngine.editing.removePoints([...ids]);
  }

  addContour(): ContourId {
    return this.#fontEngine.editing.addContour();
  }

  closeContour(): void {
    this.#fontEngine.editing.closeContour();
  }

  toggleSmooth(id: PointId): void {
    this.#fontEngine.editing.toggleSmooth(id);
  }

  getActiveContourId(): ContourId | null {
    const id = this.#fontEngine.editing.getActiveContourId();
    return id ? asContourId(id) : null;
  }

  getActiveContour(): Contour | null {
    const activeContourId = this.getActiveContourId();
    if (!activeContourId) return null;
    return this.#getContourById(activeContourId);
  }

  setActiveContour(contourId: ContourId): void {
    this.#fontEngine.editing.setActiveContour(contourId);
  }

  clearActiveContour(): void {
    this.#fontEngine.editing.clearActiveContour();
  }

  reverseContour(contourId: ContourId): void {
    this.#fontEngine.editing.reverseContour(contourId);
  }
}
