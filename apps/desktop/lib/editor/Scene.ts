import { PointType } from '@shift/shared';

import { EntityId, Ident } from '@/lib/core/EntityId';
import { Point2D } from '@/types/math';
import { CubicSegment } from '@/types/segments';

import { ContourManager, ContourNode } from './ContourManager';
import { Contour, ContourPoint } from '../core/Contour';
import { Path2D } from '../graphics/Path';

export interface Guides {
  xAdvance: number;
  ascender: { y: number };
  capHeight: { y: number };
  xHeight: { y: number };
  baseline: { y: number };
  descender: { y: number };
}

export class Scene {
  #contourManager: ContourManager;
  #staticGuides: Path2D;

  public constructor() {
    this.#contourManager = new ContourManager();
    this.#staticGuides = new Path2D();
  }

  public constructGuidesPath(guides: Guides): Path2D {
    this.#staticGuides.clear();

    // Draw horizontal guide lines
    this.#staticGuides.moveTo(0, guides.ascender.y);
    this.#staticGuides.lineTo(guides.xAdvance, guides.ascender.y);

    this.#staticGuides.moveTo(0, guides.capHeight.y);
    this.#staticGuides.lineTo(guides.xAdvance, guides.capHeight.y);

    this.#staticGuides.moveTo(0, guides.xHeight.y);
    this.#staticGuides.lineTo(guides.xAdvance, guides.xHeight.y);

    this.#staticGuides.moveTo(0, guides.baseline.y);
    this.#staticGuides.lineTo(guides.xAdvance, guides.baseline.y);

    this.#staticGuides.moveTo(0, guides.descender.y);
    this.#staticGuides.lineTo(guides.xAdvance, guides.descender.y);

    // Draw vertical guide lines
    this.#staticGuides.moveTo(0, guides.descender.y);
    this.#staticGuides.lineTo(0, guides.ascender.y);
    this.#staticGuides.moveTo(guides.xAdvance, guides.descender.y);
    this.#staticGuides.lineTo(guides.xAdvance, guides.ascender.y);

    return this.#staticGuides;
  }

  public getGuidesPath(): Path2D {
    return this.#staticGuides;
  }

  public addPoint(x: number, y: number, pointType: PointType): EntityId {
    return this.#contourManager.addPoint(x, y, pointType);
  }

  public closeContour(): EntityId {
    return this.#contourManager.closeContour();
  }

  public addContour(contour?: Contour): EntityId {
    return this.#contourManager.addContour(contour);
  }

  public movePointTo(point: Point2D, id: EntityId) {
    this.#contourManager.movePointTo(point, id);
  }

  public upgradeLineSegment(id: EntityId): EntityId {
    return this.#contourManager.upgradeLineSegment(id);
  }

  public getCubicSegment(id: EntityId): CubicSegment | undefined {
    return this.#contourManager.getCubicSegment(id);
  }

  public invalidateContour(id: Ident): void {
    this.#contourManager.invalidateContour(id);
  }

  public loadContours(contours: Contour[]): void {
    this.#contourManager.loadContours(contours);
  }

  // TODO: perhaps make this into a single functions where
  // you can pass optional IDs and if not it returns all points
  public getAllPoints(): ReadonlyArray<ContourPoint> {
    return this.#contourManager
      .nodes()
      .map((c) => {
        return c.contour.points;
      })
      .flat();
  }

  public getAllContours() {
    return this.#contourManager
      .nodes()
      .map((c) => {
        return c.contour;
      })
      .flat();
  }

  nodes(): ContourNode[] {
    return this.#contourManager.nodes();
  }
}
