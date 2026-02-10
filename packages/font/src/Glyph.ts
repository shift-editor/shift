/**
 * Pure utility functions for querying glyph structures.
 *
 * The `Glyphs` namespace provides point lookup, iteration, and spatial
 * queries over the immutable {@link Glyph} domain type. Every function is
 * stateless -- it reads the glyph and returns a result without mutation.
 *
 * @module
 */
import type { Point, Contour, Glyph, PointId, Point2D } from "@shift/types";
import { Vec2 } from "@shift/geo";

/**
 * A point together with the contour it belongs to and its index within that
 * contour's `points` array. Returned by iteration and lookup helpers.
 */
export interface PointInContour {
  point: Point;
  contour: Contour;
  index: number;
}

export const Glyphs = {
  /**
   * Locate a point by ID across all contours.
   * @returns The point, its parent contour, and index, or `null` if not found.
   */
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

  /** Lazily iterate every point in the glyph, yielding {@link PointInContour} tuples. */
  *points(glyph: Glyph): Generator<PointInContour> {
    for (const contour of glyph.contours) {
      for (let i = 0; i < contour.points.length; i++) {
        yield { point: contour.points[i], contour, index: i };
      }
    }
  },

  /** Return all points whose IDs appear in `pointIds`. Order follows contour iteration order. */
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

  /**
   * Find the first point within `radius` of `pos` (linear scan).
   * @returns The matching point, or `null` if none is close enough.
   */
  getPointAt(glyph: Glyph, pos: Point2D, radius: number): Point | null {
    for (const { point } of Glyphs.points(glyph)) {
      if (Vec2.dist(point, pos) < radius) {
        return point;
      }
    }
    return null;
  },
} as const;
