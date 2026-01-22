import type { GlyphSnapshot, PointSnapshot } from "@/types/generated";
import type { PointId } from "@/types/ids";
import type { SegmentId } from "@/types/indicator";
import { asPointId } from "@/types/ids";
import type { ClipboardContent, ContourContent, PointContent } from "./types";

export class ContentResolver {
  resolve(
    snapshot: GlyphSnapshot | null,
    selectedPointIds: ReadonlySet<PointId>,
    selectedSegmentIds: ReadonlySet<SegmentId>,
  ): ClipboardContent | null {
    if (!snapshot) return null;

    const allPointIds = this.#expandSegmentsToPoints(
      selectedPointIds,
      selectedSegmentIds,
    );

    if (allPointIds.size === 0) return null;

    const contourGroups = this.#groupPointsByContour(snapshot, allPointIds);
    const contours = this.#buildContourContents(snapshot, contourGroups);

    if (contours.length === 0) return null;

    return { contours };
  }

  #expandSegmentsToPoints(
    selectedPointIds: ReadonlySet<PointId>,
    selectedSegmentIds: ReadonlySet<SegmentId>,
  ): Set<PointId> {
    const result = new Set<PointId>(selectedPointIds);

    for (const segmentId of selectedSegmentIds) {
      const [id1, id2] = segmentId.split(":");
      result.add(asPointId(id1));
      result.add(asPointId(id2));
    }

    return result;
  }

  #groupPointsByContour(
    snapshot: GlyphSnapshot,
    pointIds: Set<PointId>,
  ): Map<string, { indices: Set<number>; contourIdx: number }> {
    const groups = new Map<string, { indices: Set<number>; contourIdx: number }>();

    for (let contourIdx = 0; contourIdx < snapshot.contours.length; contourIdx++) {
      const contour = snapshot.contours[contourIdx];
      const indices = new Set<number>();

      for (let pointIdx = 0; pointIdx < contour.points.length; pointIdx++) {
        const point = contour.points[pointIdx];
        if (pointIds.has(asPointId(point.id))) {
          indices.add(pointIdx);
        }
      }

      if (indices.size > 0) {
        groups.set(contour.id, { indices, contourIdx });
      }
    }

    return groups;
  }

  #buildContourContents(
    snapshot: GlyphSnapshot,
    groups: Map<string, { indices: Set<number>; contourIdx: number }>,
  ): ContourContent[] {
    const contours: ContourContent[] = [];

    for (const [, { indices, contourIdx }] of groups) {
      const contour = snapshot.contours[contourIdx];
      const isFullContour = indices.size === contour.points.length;

      if (isFullContour) {
        contours.push({
          points: contour.points.map(this.#pointToContent),
          closed: contour.closed,
        });
      } else {
        const expandedPoints = this.#expandPartialSelection(contour.points, indices);
        contours.push({
          points: expandedPoints.map(this.#pointToContent),
          closed: false,
        });
      }
    }

    return contours;
  }

  #expandPartialSelection(
    points: PointSnapshot[],
    selectedIndices: Set<number>,
  ): PointSnapshot[] {
    if (selectedIndices.size === 0) return [];

    const expanded = new Set<number>(selectedIndices);

    for (const idx of selectedIndices) {
      const point = points[idx];
      if (point.pointType === "onCurve") {
        this.#expandContextForOnCurve(points, idx, expanded);
      } else {
        this.#expandContextForOffCurve(points, idx, expanded);
      }
    }

    const sortedIndices = [...expanded].sort((a, b) => a - b);
    return sortedIndices.map((idx) => points[idx]);
  }

  #expandContextForOnCurve(
    points: PointSnapshot[],
    idx: number,
    expanded: Set<number>,
  ): void {
    const prevIdx = idx > 0 ? idx - 1 : null;
    const nextIdx = idx < points.length - 1 ? idx + 1 : null;

    if (prevIdx !== null && points[prevIdx].pointType === "offCurve") {
      expanded.add(prevIdx);
      const prevPrevIdx = prevIdx > 0 ? prevIdx - 1 : null;
      if (prevPrevIdx !== null && points[prevPrevIdx].pointType === "offCurve") {
        expanded.add(prevPrevIdx);
      }
    }

    if (nextIdx !== null && points[nextIdx].pointType === "offCurve") {
      expanded.add(nextIdx);
      const nextNextIdx = nextIdx < points.length - 1 ? nextIdx + 1 : null;
      if (nextNextIdx !== null && points[nextNextIdx].pointType === "offCurve") {
        expanded.add(nextNextIdx);
      }
    }
  }

  #expandContextForOffCurve(
    points: PointSnapshot[],
    idx: number,
    expanded: Set<number>,
  ): void {
    const prevIdx = idx > 0 ? idx - 1 : null;
    const nextIdx = idx < points.length - 1 ? idx + 1 : null;

    if (prevIdx !== null) {
      expanded.add(prevIdx);
    }
    if (nextIdx !== null) {
      expanded.add(nextIdx);
    }
  }

  #pointToContent = (point: PointSnapshot): PointContent => ({
    x: point.x,
    y: point.y,
    pointType: point.pointType,
    smooth: point.smooth,
  });
}
