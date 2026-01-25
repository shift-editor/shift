import { parseSegments } from "@/engine/segments";
import { Segment } from "@/lib/geo/Segment";
import { Vec2 } from "@shift/geo";
import { asPointId } from "@shift/types";
import type { GlyphSnapshot, PointId } from "@shift/types";
import type { SelectionBounds } from "./types";

export function getSegmentAwareBounds(
  snapshot: GlyphSnapshot,
  selectedPointIds: ReadonlySet<PointId>,
): SelectionBounds | null {
  if (selectedPointIds.size === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const processedSegments = new Set<string>();
  const pointsInFullSegments = new Set<PointId>();

  for (const contour of snapshot.contours) {
    const segments = parseSegments(contour.points, contour.closed);

    for (const segment of segments) {
      const segmentPointIds = Segment.getPointIds(segment);
      const allSelected = segmentPointIds.every((id) =>
        selectedPointIds.has(id),
      );

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

    for (const point of contour.points) {
      const pointId = asPointId(point.id);
      if (selectedPointIds.has(pointId) && !pointsInFullSegments.has(pointId)) {
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
