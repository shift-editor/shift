import type { Point2D, Rect2D, Point, ContourId, PointId, Contour, Glyph } from "@shift/types";
import type { SegmentHitResult } from "@/lib/geo/Segment";
import type { Segment } from "@/types/segments";
import type { SegmentId } from "@/types/indicator";
import type { MiddlePointHit } from "@/types/hitResult";
import { Vec2, Contours } from "@shift/geo";

export interface ContourEndpointHit {
  contourId: ContourId;
  pointId: PointId;
  position: "start" | "end";
  contour: Contour;
}

export interface HitTestServiceDeps {
  getPointAt: (pos: Point2D) => Point | null;
  getSegmentAt: (pos: Point2D) => SegmentHitResult | null;
  getContourEndpointAt: (pos: Point2D) => ContourEndpointHit | null;
  getSelectionBoundingRect: () => Rect2D | null;
  getAllPoints: () => Point[];
  getSegmentById: (segmentId: SegmentId) => Segment | null;
  updateHover: (pos: Point2D) => void;
  getGlyph: () => Glyph | null;
  getActiveContourId: () => ContourId | null;
  getHitRadius: () => number;
}

export class HitTestService {
  #deps: HitTestServiceDeps;

  constructor(deps: HitTestServiceDeps) {
    this.#deps = deps;
  }

  getPointAt(pos: Point2D): Point | null {
    return this.#deps.getPointAt(pos);
  }

  getSegmentAt(pos: Point2D): SegmentHitResult | null {
    return this.#deps.getSegmentAt(pos);
  }

  getContourEndpointAt(pos: Point2D): ContourEndpointHit | null {
    return this.#deps.getContourEndpointAt(pos);
  }

  getSelectionBoundingRect(): Rect2D | null {
    return this.#deps.getSelectionBoundingRect();
  }

  getAllPoints(): Point[] {
    return this.#deps.getAllPoints();
  }

  getSegmentById(segmentId: SegmentId): Segment | null {
    return this.#deps.getSegmentById(segmentId);
  }

  updateHover(pos: Point2D): void {
    this.#deps.updateHover(pos);
  }

  getMiddlePointAt(pos: Point2D): MiddlePointHit | null {
    const glyph = this.#deps.getGlyph();
    if (!glyph) return null;

    const activeContourId = this.#deps.getActiveContourId();
    const hitRadius = this.#deps.getHitRadius();

    for (const contour of glyph.contours) {
      if (contour.id === activeContourId || contour.closed) continue;
      if (!Contours.hasInteriorPoints(contour)) continue;

      for (let i = 1; i < contour.points.length - 1; i++) {
        const point = contour.points[i];
        if (Vec2.dist(pos, point) < hitRadius) {
          return {
            type: "middlePoint",
            contourId: contour.id as ContourId,
            pointId: point.id as PointId,
            pointIndex: i,
          };
        }
      }
    }
    return null;
  }
}
