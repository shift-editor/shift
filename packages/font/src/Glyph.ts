import type { Point, Contour, Glyph, PointId, Point2D } from "@shift/types";
import { Vec2 } from "@shift/geo";

export interface PointInContour {
  point: Point;
  contour: Contour;
  index: number;
}

export const Glyphs = {
  findPoint(
    glyph: Glyph,
    pointId: PointId,
  ): { point: Point; contour: Contour; index: number } | null {
    for (const contour of glyph.contours) {
      const index = contour.points.findIndex((p) => p.id === pointId);
      if (index !== -1) {
        return { point: contour.points[index], contour, index };
      }
    }
    return null;
  },

  findContour(glyph: Glyph, contourId: string): Contour | undefined {
    return glyph.contours.find((c) => c.id === contourId);
  },

  *points(glyph: Glyph): Generator<PointInContour> {
    for (const contour of glyph.contours) {
      for (let i = 0; i < contour.points.length; i++) {
        yield { point: contour.points[i], contour, index: i };
      }
    }
  },

  findPoints(glyph: Glyph, pointIds: Iterable<PointId>): Point[] {
    const idSet = new Set(pointIds);
    const result: Point[] = [];
    for (const { point } of Glyphs.points(glyph)) {
      if (idSet.has(point.id)) {
        result.push(point);
      }
    }
    return result;
  },

  getAllPoints(glyph: Glyph): Point[] {
    return Array.from(Glyphs.points(glyph), ({ point }) => point);
  },

  getPointAt(glyph: Glyph, pos: Point2D, radius: number): Point | null {
    for (const { point } of Glyphs.points(glyph)) {
      if (Vec2.dist(point, pos) < radius) {
        return point;
      }
    }
    return null;
  },
} as const;
