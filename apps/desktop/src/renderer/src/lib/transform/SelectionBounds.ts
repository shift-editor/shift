import { Segment } from "@/lib/geo/Segment";
import { Vec2 } from "@shift/geo";
import { asPointId } from "@shift/types";
import type { GlyphSnapshot, PointId } from "@shift/types";
import type { SelectionBounds } from "./types";

export function getSegmentAwareBounds(
  snapshot: GlyphSnapshot,
  selectedPointIds: readonly PointId[],
): SelectionBounds | null {
  if (selectedPointIds.length === 0) return null;

  const selectedSet = new Set(selectedPointIds);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
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
        const bounds = Segment.bounds(segment);
        minX = Math.min(minX, bounds.min.x);
        minY = Math.min(minY, bounds.min.y);
        maxX = Math.max(maxX, bounds.max.x);
        maxY = Math.max(maxY, bounds.max.y);
      }
    }
  }

  for (const contour of snapshot.contours) {
    for (const point of contour.points) {
      const pointId = asPointId(point.id);
      if (selectedSet.has(pointId) && !pointsInFullSegments.has(pointId)) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
    }
  }

  if (minX === Infinity) return null;

  return {
    center: Vec2.midpoint({ x: minX, y: minY }, { x: maxX, y: maxY }),
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
