import type { Editor } from "@/lib/editor/Editor";
import { UPMRect } from "@/lib/math/rect";
import type { Point2D } from "@/types/math";
import type { PointId } from "@/types/ids";
import { asPointId } from "@/types/ids";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import type { PointSnapshot, GlyphSnapshot } from "@/types/generated";
import { NUDGES_VALUES, type NudgeMagnitude } from "@/types/nudge";
import { Vec2, Segment } from "@/lib/geo";
import { parseSegments } from "@/engine/segments";
import type { SegmentHitResult } from "@/lib/geo";
import type { Segment as SegmentType } from "@/types/segments";

function findPointAtPosition(
  points: PointSnapshot[],
  pos: Point2D,
  hitRadius: number,
): PointSnapshot | null {
  for (const point of points) {
    if (Vec2.dist(point, pos) < hitRadius) {
      return point;
    }
  }
  return null;
}

function findPointsInRect(
  points: PointSnapshot[],
  rect: UPMRect,
): PointSnapshot[] {
  return points.filter((p) => rect.hit(p.x, p.y));
}

function getAllPoints(
  snapshot: { contours: Array<{ points: PointSnapshot[] }> } | null,
): PointSnapshot[] {
  if (!snapshot) return [];
  const result: PointSnapshot[] = [];
  for (const contour of snapshot.contours) {
    result.push(...contour.points);
  }
  return result;
}

function hitTestSegments(
  snapshot: GlyphSnapshot | null,
  pos: Point2D,
  hitRadius: number,
): SegmentHitResult | null {
  if (!snapshot) return null;

  for (const contour of snapshot.contours) {
    const segments = parseSegments(contour.points, contour.closed);
    const hit = Segment.hitTestMultiple(segments, pos, hitRadius);
    if (hit) {
      return hit;
    }
  }

  return null;
}

/**
 * Get all point IDs from a segment (anchors + control points).
 */
function getSegmentPointIds(segment: SegmentType): PointId[] {
  switch (segment.type) {
    case "line":
      return [
        asPointId(segment.points.anchor1.id),
        asPointId(segment.points.anchor2.id),
      ];
    case "quad":
      return [
        asPointId(segment.points.anchor1.id),
        asPointId(segment.points.control.id),
        asPointId(segment.points.anchor2.id),
      ];
    case "cubic":
      return [
        asPointId(segment.points.anchor1.id),
        asPointId(segment.points.control1.id),
        asPointId(segment.points.control2.id),
        asPointId(segment.points.anchor2.id),
      ];
  }
}

/**
 * Find a segment by its ID in the snapshot.
 */
function findSegmentById(
  snapshot: GlyphSnapshot | null,
  segmentId: SegmentId,
): SegmentType | null {
  if (!snapshot) return null;

  for (const contour of snapshot.contours) {
    const segments = parseSegments(contour.points, contour.closed);
    for (const segment of segments) {
      if (Segment.id(segment) === segmentId) {
        return segment;
      }
    }
  }

  return null;
}

export interface HitTestResult {
  point: PointSnapshot | null;
  pointId: PointId | null;
}

export interface SegmentHitTestResult {
  segmentId: SegmentId;
  segment: SegmentType;
  closestPoint: Point2D;
  t: number;
  pointIds: PointId[];
}

export interface RectSelectResult {
  points: PointSnapshot[];
  pointIds: Set<PointId>;
}

export class SelectCommands {
  #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  hitTest(pos: Point2D): HitTestResult {
    const ctx = this.#editor.createToolContext();
    const allPoints = getAllPoints(ctx.snapshot);
    const hitRadius = ctx.screen.hitRadius;
    const hitPoint = findPointAtPosition(allPoints, pos, hitRadius);

    if (hitPoint) {
      return { point: hitPoint, pointId: asPointId(hitPoint.id) };
    }
    return { point: null, pointId: null };
  }

  selectPoint(pointId: PointId, additive: boolean): void {
    const ctx = this.#editor.createToolContext();
    if (additive) {
      const newSelection = new Set(ctx.selectedPoints);
      newSelection.add(pointId);
      ctx.select.set(newSelection);
    } else {
      ctx.select.set(new Set([pointId]));
    }
  }

  selectPointsInRect(rect: UPMRect): RectSelectResult {
    const ctx = this.#editor.createToolContext();
    const allPoints = getAllPoints(ctx.snapshot);
    const hitPoints = findPointsInRect(allPoints, rect);
    const pointIds = new Set(hitPoints.map((p) => asPointId(p.id)));
    ctx.select.set(pointIds);
    return { points: hitPoints, pointIds };
  }

  clearSelection(): void {
    const ctx = this.#editor.createToolContext();
    ctx.select.clear();
  }

  togglePointInSelection(pointId: PointId): void {
    const ctx = this.#editor.createToolContext();
    ctx.select.toggle(pointId);
  }

  isPointSelected(pointId: PointId): boolean {
    const ctx = this.#editor.createToolContext();
    return ctx.selectedPoints.has(pointId);
  }

  hasSelection(): boolean {
    const ctx = this.#editor.createToolContext();
    return ctx.select.has();
  }

  moveSelectedPoints(anchorId: PointId, currentPos: Point2D): Point2D {
    const ctx = this.#editor.createToolContext();
    const allPoints = getAllPoints(ctx.snapshot);
    const dragPoint = allPoints.find((p) => p.id === anchorId);

    if (!dragPoint) {
      return Vec2.zero();
    }

    const delta = Vec2.sub(currentPos, dragPoint);

    if (!Vec2.isZero(delta)) {
      ctx.edit.applySmartEdits(ctx.selectedPoints, delta.x, delta.y);
    }

    return delta;
  }

  moveSelectedPointsByDelta(delta: Point2D): void {
    const ctx = this.#editor.createToolContext();
    if (!Vec2.isZero(delta)) {
      ctx.edit.applySmartEdits(ctx.selectedPoints, delta.x, delta.y);
    }
  }

  nudgeSelectedPoints(dx: number, dy: number): void {
    const ctx = this.#editor.createToolContext();
    if (ctx.selectedPoints.size > 0) {
      ctx.edit.movePoints(ctx.selectedPoints, dx, dy);
    }
  }

  getNudgeValue(modifier: NudgeMagnitude): number {
    return NUDGES_VALUES[modifier];
  }

  updateHover(pos: Point2D): void {
    const ctx = this.#editor.createToolContext();
    const hitRadius = ctx.screen.hitRadius;

    const { pointId } = this.hitTest(pos);
    if (pointId) {
      ctx.indicators.setHoveredPoint(pointId);
      return;
    }

    const segmentHit = hitTestSegments(ctx.snapshot, pos, hitRadius);
    if (segmentHit) {
      ctx.indicators.setHoveredSegment({
        segmentId: segmentHit.segmentId,
        closestPoint: segmentHit.point,
        t: segmentHit.t,
      });
      return;
    }

    ctx.indicators.clearAll();
  }

  toggleSmooth(pos: Point2D): boolean {
    const ctx = this.#editor.createToolContext();
    const { point, pointId } = this.hitTest(pos);
    if (point && pointId && point.pointType === "onCurve") {
      ctx.edit.toggleSmooth(pointId);
      ctx.requestRedraw();
      return true;
    }
    return false;
  }

  hitTestSegment(pos: Point2D): SegmentHitTestResult | null {
    const ctx = this.#editor.createToolContext();
    const hitRadius = ctx.screen.hitRadius;
    const hit = hitTestSegments(ctx.snapshot, pos, hitRadius);

    if (!hit) return null;

    const segment = findSegmentById(ctx.snapshot, hit.segmentId);
    if (!segment) return null;

    return {
      segmentId: hit.segmentId,
      segment,
      closestPoint: hit.point,
      t: hit.t,
      pointIds: getSegmentPointIds(segment),
    };
  }

  selectSegment(segmentId: SegmentId, additive: boolean): PointId[] {
    const ctx = this.#editor.createToolContext();
    const segment = findSegmentById(ctx.snapshot, segmentId);

    if (!segment) return [];

    const pointIds = getSegmentPointIds(segment);

    // Select the segment
    if (additive) {
      this.#editor.addSegmentToSelection(segmentId);
    } else {
      this.#editor.selectSegment(segmentId);
    }

    // Also select all the segment's points (anchors + control points)
    if (additive) {
      for (const id of pointIds) {
        this.#editor.addPointToSelection(id);
      }
    } else {
      this.#editor.selectPoints(new Set(pointIds));
    }

    return pointIds;
  }

  isSegmentSelected(segmentId: SegmentId): boolean {
    return this.#editor.isSegmentSelected(segmentId);
  }

  toggleSegment(segmentId: SegmentId): PointId[] {
    const ctx = this.#editor.createToolContext();
    const wasSelected = this.#editor.isSegmentSelected(segmentId);

    // Toggle the segment
    this.#editor.toggleSegmentInSelection(segmentId);

    const segment = findSegmentById(ctx.snapshot, segmentId);
    if (!segment) return [];

    const pointIds = getSegmentPointIds(segment);

    if (wasSelected) {
      // Segment was deselected - remove all its points from selection
      for (const id of pointIds) {
        this.#editor.removePointFromSelection(id);
      }
      return [];
    } else {
      // Segment was selected - add all its points to selection
      for (const id of pointIds) {
        this.#editor.addPointToSelection(id);
      }
      return pointIds;
    }
  }

  getHoveredSegment(): SegmentIndicator | null {
    return this.#editor.hoveredSegmentId;
  }
}
