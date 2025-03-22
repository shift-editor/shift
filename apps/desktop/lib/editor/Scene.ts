import { PointType } from '@shift/shared';

import { EntityId, Ident } from '@/lib/core/EntityId';
import { Point2D } from '@/types/math';
import { CubicSegment } from '@/types/segments';

import { ContourManager } from './ContourManager';
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
  #glyphPath: Path2D;

  public constructor() {
    this.#contourManager = new ContourManager();
    this.#staticGuides = new Path2D();
    this.#glyphPath = new Path2D();
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

  public getGlyphPath(): Path2D {
    this.rebuildGlyphPath();
    return this.#glyphPath;
  }

  public rebuildGlyphPath(): void {
    this.#glyphPath.clear();

    for (const contour of this.#contourManager.contours()) {
      if (contour.points.length < 2) {
        continue;
      }

      const segments = contour.segments();

      if (segments.length === 0) continue;

      this.#glyphPath.moveTo(segments[0].points.anchor1.x, segments[0].points.anchor1.y);

      for (const segment of segments) {
        switch (segment.type) {
          case 'line':
            this.#glyphPath.lineTo(segment.points.anchor2.x, segment.points.anchor2.y);
            break;
          case 'quad':
            this.#glyphPath.quadTo(
              segment.points.control.x,
              segment.points.control.y,
              segment.points.anchor2.x,
              segment.points.anchor2.y
            );
            break;
          case 'cubic':
            this.#glyphPath.cubicTo(
              segment.points.control1.x,
              segment.points.control1.y,
              segment.points.control2.x,
              segment.points.control2.y,
              segment.points.anchor2.x,
              segment.points.anchor2.y
            );
            break;
        }
      }

      if (contour.closed) {
        this.#glyphPath.closePath();
      }
    }
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

  public setActiveContour(id: EntityId) {
    this.#contourManager.setActiveContour(id);
  }

  public invalidateGlyph(): void {
    this.#glyphPath.invalidated = true;
  }

  public clearContours() {
    this.#contourManager.clearContours();
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

  public loadContours(contours: Contour[]): void {
    this.#contourManager.loadContours(contours);
  }

  // TODO: perhaps make this into a single functions where
  // you can pass optional IDs and if not it returns all points
  public getAllPoints(): ReadonlyArray<ContourPoint> {
    return this.#contourManager
      .contours()
      .map((c) => {
        return c.points;
      })
      .flat();
  }

  public getAllContours() {
    return this.#contourManager
      .contours()
      .map((c) => {
        return c;
      })
      .flat();
  }

  contours(): Contour[] {
    return this.#contourManager.contours();
  }
}
