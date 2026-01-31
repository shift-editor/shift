/**
 * Snapshot utility functions for querying and manipulating GlyphSnapshot data.
 */

import type { PointSnapshot, ContourSnapshot, GlyphSnapshot, PointId } from "@shift/types";

/**
 * Creates an empty glyph snapshot for initialization
 */
export function createEmptyGlyphSnapshot(unicode: number): GlyphSnapshot {
  return {
    unicode,
    name: "",
    xAdvance: 500,
    contours: [],
    activeContourId: null,
  };
}

/**
 * Finds a point by ID across all contours.
 * Returns the point along with its contour and index for context.
 */
export function findPointInSnapshot(
  snapshot: GlyphSnapshot,
  pointId: PointId,
): { point: PointSnapshot; contour: ContourSnapshot; index: number } | null {
  for (const contour of snapshot.contours) {
    const index = contour.points.findIndex((p) => p.id === pointId);
    if (index !== -1) {
      return {
        point: contour.points[index],
        contour,
        index,
      };
    }
  }
  return null;
}

/**
 * Finds multiple points by IDs across all contours.
 * Returns points in the order they appear in the contours (not the input order).
 */
export function findPointsInSnapshot(
  snapshot: GlyphSnapshot,
  pointIds: Iterable<string>,
): PointSnapshot[] {
  const idSet = new Set(pointIds);
  const result: PointSnapshot[] = [];

  for (const contour of snapshot.contours) {
    for (const point of contour.points) {
      if (idSet.has(point.id)) {
        result.push(point);
      }
    }
  }

  return result;
}

/**
 * Finds a contour by ID
 */
export function findContourInSnapshot(
  snapshot: GlyphSnapshot,
  contourId: string,
): ContourSnapshot | undefined {
  return snapshot.contours.find((c) => c.id === contourId);
}

/**
 * Gets all point IDs from a snapshot
 */
export function getAllPointIds(snapshot: GlyphSnapshot): string[] {
  return snapshot.contours.flatMap((c) => c.points.map((p) => p.id));
}

/**
 * Get all points from a snapshot as a flat array with contour info.
 */
export function getAllPointsFromSnapshot(
  snapshot: GlyphSnapshot,
): Array<{ point: PointSnapshot; contour: ContourSnapshot; index: number }> {
  const result: Array<{
    point: PointSnapshot;
    contour: ContourSnapshot;
    index: number;
  }> = [];

  for (const contour of snapshot.contours) {
    for (let i = 0; i < contour.points.length; i++) {
      result.push({
        point: contour.points[i],
        contour,
        index: i,
      });
    }
  }

  return result;
}
