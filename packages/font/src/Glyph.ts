import type { Point, Contour, Glyph, PointId, Point2D } from "@shift/types";
import { Vec2 } from "@shift/geo";

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

  findPoints(glyph: Glyph, pointIds: Iterable<PointId>): Point[] {
    const idSet = new Set(pointIds);
    const result: Point[] = [];

    for (const contour of glyph.contours) {
      for (const point of contour.points) {
        if (idSet.has(point.id)) {
          result.push(point);
        }
      }
    }

    return result;
  },

  getAllPoints(glyph: Glyph): Point[] {
    const result: Point[] = [];
    for (const contour of glyph.contours) {
      result.push(...contour.points);
    }
    return result;
  },

  getPointAt(glyph: Glyph, pos: Point2D, radius: number): Point | null {
    for (const contour of glyph.contours) {
      for (const point of contour.points) {
        if (Vec2.dist(point, pos) < radius) {
          return point;
        }
      }
    }
    return null;
  },
} as const;
