/**
 * Pure utility functions for querying glyph structures.
 *
 * The `Glyphs` namespace provides point lookup, iteration, and spatial
 * queries over the immutable {@link Glyph} domain type. Every function is
 * stateless -- it reads the glyph and returns a result without mutation.
 *
 * @module
 */
import type { Point, Contour, Glyph, PointId, ContourId, Point2D } from "@shift/types";

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
        const point = contour.points[index];
        if (point) {
          return { point, contour, index };
        }
      }
    }
    return null;
  },

  findContour(glyph: Glyph, contourId: ContourId): Contour | undefined {
    return glyph.contours.find((c) => c.id === contourId);
  },

  /** Lazily iterate every point in the glyph, yielding {@link PointInContour} tuples. */
  *points(glyph: Glyph): Generator<PointInContour> {
    for (const contour of glyph.contours) {
      for (const [i, point] of contour.points.entries()) {
        yield { point, contour, index: i };
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
   *
   * Hot path — called on every pointer-move from the cursor computed.
   * Iterates contour points inline (no `points()` generator allocation)
   * and uses squared-distance comparison (no `Math.sqrt`).
   */
  getPointAt(glyph: Glyph, pos: Point2D, radius: number): Point | null {
    const r2 = radius * radius;
    const px = pos.x;
    const py = pos.y;
    for (const contour of glyph.contours) {
      for (const point of contour.points) {
        const dx = point.x - px;
        const dy = point.y - py;
        if (dx * dx + dy * dy < r2) return point;
      }
    }
    return null;
  },
} as const;
