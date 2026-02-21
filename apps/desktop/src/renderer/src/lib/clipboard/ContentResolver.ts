import type { Contour, Glyph, Point, PointId } from "@shift/types";
import { Contours } from "@shift/font";
import { Validate } from "@shift/validation";
import type { SegmentId } from "@/types/indicator";
import type { ClipboardContent, ContourContent, PointContent } from "./types";

export class ContentResolver {
  resolve(
    glyph: Glyph | null,
    selectedPointIds: readonly PointId[],
    selectedSegmentIds: readonly SegmentId[],
  ): ClipboardContent | null {
    if (!glyph) return null;

    const allPointIds = this.#expandSegmentsToPoints(new Set(selectedPointIds), selectedSegmentIds);

    if (allPointIds.size === 0) return null;

    const contourGroups = this.#groupPointsByContour(glyph, allPointIds);
    const contours = this.#buildContourContents(glyph, contourGroups);

    if (contours.length === 0) return null;

    return { contours };
  }

  #expandSegmentsToPoints(
    selectedPointIds: ReadonlySet<PointId>,
    selectedSegmentIds: readonly SegmentId[],
  ): Set<PointId> {
    const result = new Set<PointId>(selectedPointIds);

    for (const segmentId of selectedSegmentIds) {
      const [id1, id2] = segmentId.split(":");
      result.add(id1 as PointId);
      result.add(id2 as PointId);
    }

    return result;
  }

  #groupPointsByContour(
    glyph: Glyph,
    pointIds: Set<PointId>,
  ): Map<string, { indices: Set<number>; contourIdx: number }> {
    const groups = new Map<string, { indices: Set<number>; contourIdx: number }>();

    for (const [contourIdx, contour] of glyph.contours.entries()) {
      const indices = new Set<number>();

      for (const [pointIdx, point] of contour.points.entries()) {
        if (pointIds.has(point.id)) {
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
    glyph: Glyph,
    groups: Map<string, { indices: Set<number>; contourIdx: number }>,
  ): ContourContent[] {
    const contours: ContourContent[] = [];

    for (const [, { indices, contourIdx }] of groups) {
      const contour = glyph.contours[contourIdx];
      if (!contour) {
        continue;
      }
      const isFullContour = indices.size === contour.points.length;

      if (isFullContour) {
        contours.push({
          points: contour.points.map(this.#pointToContent),
          closed: contour.closed,
        });
      } else {
        const expandedPoints = this.#expandPartialSelection(contour, indices);
        if (!Validate.hasValidAnchor(expandedPoints)) {
          continue;
        }
        contours.push({
          points: expandedPoints.map(this.#pointToContent),
          closed: false,
        });
      }
    }

    return contours;
  }

  #expandPartialSelection(contour: Contour, selectedIndices: Set<number>): readonly Point[] {
    if (selectedIndices.size === 0) return [];

    const expanded = new Set<number>(selectedIndices);

    for (const idx of selectedIndices) {
      const point = Contours.at(contour, idx, false);
      if (!point) {
        continue;
      }
      if (Validate.isOnCurve(point)) {
        this.#expandContextForOnCurve(contour, idx, expanded);
      } else {
        this.#expandContextForOffCurve(contour, idx, expanded);
      }
    }

    const sortedIndices = [...expanded].sort((a, b) => a - b);
    const expandedPoints: Point[] = [];
    for (const idx of sortedIndices) {
      const point = Contours.at(contour, idx, false);
      if (point) {
        expandedPoints.push(point);
      }
    }
    return expandedPoints;
  }

  #expandContextForOnCurve(contour: Contour, idx: number, expanded: Set<number>): void {
    const prev = Contours.at(contour, idx - 1, false);
    if (prev && Validate.isOffCurve(prev)) {
      expanded.add(idx - 1);
      const prevPrev = Contours.at(contour, idx - 2, false);
      if (prevPrev && Validate.isOffCurve(prevPrev)) {
        expanded.add(idx - 2);
      }
    }

    const next = Contours.at(contour, idx + 1, false);
    if (next && Validate.isOffCurve(next)) {
      expanded.add(idx + 1);
      const nextNext = Contours.at(contour, idx + 2, false);
      if (nextNext && Validate.isOffCurve(nextNext)) {
        expanded.add(idx + 2);
      }
    }
  }

  #expandContextForOffCurve(contour: Contour, idx: number, expanded: Set<number>): void {
    const prev = Contours.at(contour, idx - 1, false);
    if (prev) {
      expanded.add(idx - 1);
    }
    const next = Contours.at(contour, idx + 1, false);
    if (next) {
      expanded.add(idx + 1);
    }
  }

  #pointToContent = (point: Point): PointContent => ({
    x: point.x,
    y: point.y,
    pointType: point.pointType,
    smooth: point.smooth,
  });
}
