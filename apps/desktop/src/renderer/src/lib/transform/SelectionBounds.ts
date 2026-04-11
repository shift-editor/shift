import { Segment } from "@/lib/geo/Segment";
import { Bounds } from "@shift/geo";
import type { PointId } from "@shift/types";
import type { Glyph } from "@/lib/model/glyph";

/**
 * Compute a tight bounding box for the current selection that accounts for
 * curve geometry. When every point of a segment is selected, the segment's
 * full bezier bounds are used (which may extend beyond the on-curve points).
 * Points that belong to only partially-selected segments are treated as
 * isolated coordinates.
 *
 * Returns `null` when `selectedPointIds` is empty.
 */
export function getSegmentAwareBounds(
  glyph: Glyph,
  selectedPointIds: readonly PointId[],
): Bounds | null {
  if (selectedPointIds.length === 0) return null;

  const selectedSet = new Set(selectedPointIds);

  const segBounds: (Bounds | null)[] = [];
  const processedSegments = new Set<string>();
  const pointsInFullSegments = new Set<PointId>();

  for (const { segment } of Segment.iterateGlyph(glyph.contours)) {
    const segmentPointIds = Segment.getPointIds(segment);
    const allSelected = segmentPointIds.every((id) => selectedSet.has(id));

    if (allSelected) {
      const segKey = segmentPointIds.join(":");
      if (!processedSegments.has(segKey)) {
        processedSegments.add(segKey);
        for (const id of segmentPointIds) {
          pointsInFullSegments.add(id);
        }
        segBounds.push(Segment.bounds(segment));
      }
    }
  }

  const isolatedPoints: { x: number; y: number }[] = [];
  for (const contour of glyph.contours) {
    for (const point of contour.points) {
      if (selectedSet.has(point.id) && !pointsInFullSegments.has(point.id)) {
        isolatedPoints.push(point);
      }
    }
  }

  const ptBounds = Bounds.fromPoints(isolatedPoints);
  return Bounds.unionAll([...segBounds, ptBounds]);
}
