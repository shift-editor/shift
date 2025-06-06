import { PointType } from '@shift/shared';

import { Contour, ContourPoint } from '@/lib/core/Contour';
import { EntityId, Ident } from '@/lib/core/EntityId';
import { Segment } from '@/types/segments';

export class ContourManager {
  #activeContourId: EntityId | null;
  #contours: Map<Ident, Contour> = new Map();

  constructor() {
    this.#activeContourId = null;
  }

  public getContour(id: Ident): Contour | undefined {
    return this.#contours.get(id);
  }

  public setActiveContour(id: EntityId) {
    this.#activeContourId = id;
  }

  public loadContours(contours: Contour[]) {
    for (const contour of contours) {
      this.#contours.set(contour.entityId.id, contour);
    }
  }

  public clearContours() {
    this.#contours.clear();
  }

  getActiveContour(): Contour {
    if (!this.#activeContourId) {
      const c = new Contour();
      this.#contours.set(c.entityId.id, c);
      this.#activeContourId = c.entityId;
      return c;
    }

    const c = this.#contours.get(this.#activeContourId.id);
    if (!c) {
      throw new Error('Current contour not found');
    }

    return c;
  }

  addPoint(x: number, y: number, pointType: PointType): EntityId {
    if (this.pointClosesPath(x, y)) {
      return this.closeContour();
    }

    return this.getActiveContour().addPoint(x, y, pointType);
  }

  getPoint(id: EntityId): ContourPoint | undefined {
    const c = this.#contours.get(id.parentId);
    if (!c) {
      console.error('No parentId for point');
      return undefined;
    }

    const point = c.points.find((p) => p.entityId.id === id.id);
    if (!point) {
      console.error('No point found');
      return undefined;
    }

    return point;
  }

  removePoint(id: EntityId): ContourPoint | undefined {
    const c = this.#contours.get(id.parentId);
    if (!c) {
      console.error('No parentId for point');
      return;
    }

    c.removePoint(id);
  }

  getNeighborPoints(p: ContourPoint): ContourPoint[] {
    // Use the direct point relationships if available, otherwise fall back to cursor navigation
    if (p.prevPoint !== null || p.nextPoint !== null) {
      return p.getNeighbors();
    }

    // Fallback to the original cursor-based approach
    const c = this.#contours.get(p.entityId.parentId);
    if (!c) {
      console.error('No parentId for point');
      return [];
    }

    const pointCursor = c.pointCursor();
    const index = c.points.findIndex((point) => point.entityId.id === p.entityId.id);

    if (index === -1) {
      console.error('No index for point');
      return [];
    }

    pointCursor.moveTo(index);
    const neighbors = [];

    neighbors.push(pointCursor.peekPrev());
    neighbors.push(pointCursor.peekNext());

    return neighbors;
  }

  pointClosesPath(x: number, y: number): boolean {
    if (this.getActiveContour().points.length > 1) {
      const firstPoint = this.getActiveContour().firstPoint();
      return firstPoint.distance(x, y) < 6;
    }

    return false;
  }

  closeContour(): EntityId {
    const firstPoint = this.getActiveContour().firstPoint();

    this.getActiveContour().close();
    this.#activeContourId = this.addContour();

    return firstPoint.entityId;
  }

  movePointTo(id: EntityId, x: number, y: number) {
    const c = this.#contours.get(id.parentId);
    if (!c) {
      console.error('No parentId for point');
      return;
    }

    const p = c.points.find((p) => p.entityId.id === id.id);

    if (!p) {
      console.error('point not found');
      return;
    }

    p.movePointTo(x, y);
  }

  movePointBy(id: EntityId, dx: number, dy: number) {
    const c = this.#contours.get(id.parentId);
    if (!c) {
      console.error('No parentId for point');
      return;
    }

    const p = c.points.find((p) => p.entityId.id === id.id);

    if (!p) {
      console.error('point not found');
      return;
    }

    p.movePointBy(dx, dy);
  }

  addContour(contour?: Contour): EntityId {
    const c = contour ?? new Contour();
    this.#contours.set(c.entityId.id, c);

    return c.entityId;
  }

  duplicateContour(id: EntityId): EntityId {
    const c = this.#contours.get(id.id);
    if (!c) {
      console.error('No parentId for point');
      return id;
    }

    const newContour = c.clone();
    this.#contours.set(newContour.entityId.id, newContour);

    return newContour.entityId;
  }

  upgradeLineSegment(id: EntityId): EntityId {
    const c = this.#contours.get(id.parentId);
    if (!c) {
      console.error('No parentId for point');
      return id;
    }

    return c.upgradeLineSegment(id);
  }

  // TODO: Add tests
  getSegment(id: EntityId): Segment | undefined {
    const c = this.#contours.get(id.parentId);
    if (!c) {
      console.error('No parentId for point');
      return undefined;
    }

    for (const segment of c.segments()) {
      if (segment.points.anchor1.entityId === id) {
        return segment;
      }
    }

    return undefined;
  }

  contours(): Contour[] {
    return Array.from(this.#contours.values());
  }
}
