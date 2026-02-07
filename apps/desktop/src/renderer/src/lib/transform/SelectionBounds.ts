import { Segment } from "@/lib/geo/Segment";
import { Bounds } from "@shift/geo";
import { asPointId } from "@shift/types";
import type { GlyphSnapshot, PointId } from "@shift/types";

export function getSegmentAwareBounds(
  snapshot: GlyphSnapshot,
  selectedPointIds: readonly PointId[],
): Bounds | null {
  if (selectedPointIds.length === 0) return null;

  const selectedSet = new Set(selectedPointIds);

  const segBounds: (Bounds | null)[] = [];
  const processedSegments = new Set<string>();
  const pointsInFullSegments = new Set<PointId>();

  for (const { segment } of Segment.iterateGlyph(snapshot.contours)) {
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
  for (const contour of snapshot.contours) {
    for (const point of contour.points) {
      const pointId = asPointId(point.id);
      if (selectedSet.has(pointId) && !pointsInFullSegments.has(pointId)) {
        isolatedPoints.push(point);
      }
    }
  }

  const ptBounds = Bounds.fromPoints(isolatedPoints);
  return Bounds.unionAll([...segBounds, ptBounds]);
}
