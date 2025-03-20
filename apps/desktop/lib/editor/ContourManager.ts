import { PointType } from '@shift/shared';

import { Contour } from '@/lib/core/Contour';
import { EntityId, Ident } from '@/lib/core/EntityId';
import { Point2D } from '@/types/math';
import { CubicSegment } from '@/types/segments';

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

  movePointTo(point: Point2D, id: EntityId) {
    const c = this.#contours.get(id.parentId);
    if (!c) {
      console.error('No parentId for point');
      return;
    }

    const p = c.points.find((p) => {
      return p.entityId.id == id.id;
    });

    if (!p) {
      console.error('point not found');
      return;
    }

    p.movePointTo(point.x, point.y);
  }

  addContour(contour?: Contour): EntityId {
    const c = contour ?? new Contour();
    this.#contours.set(c.entityId.id, c);

    return c.entityId;
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
  getCubicSegment(id: EntityId): CubicSegment | undefined {
    const c = this.#contours.get(id.parentId);
    if (!c) {
      console.error('No parentId for point');
      return undefined;
    }

    for (const segment of c.segments()) {
      if (segment.type === 'cubic' && segment.points.anchor1.entityId === id) {
        return segment;
      }
    }
  }

  contours(): Contour[] {
    return Array.from(this.#contours.values());
  }
}
