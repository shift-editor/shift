import type { Editor } from "@/lib/editor/Editor";
import type { Point2D, PointId, PointSnapshot, GlyphSnapshot, Rect2D } from "@shift/types";
import { Polygon } from "@shift/geo";
import { asPointId } from "@shift/types";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import { NUDGES_VALUES, type NudgeMagnitude } from "@/types/nudge";
import { Vec2 } from "@shift/geo";
import { Segment } from "@/lib/geo/Segment";
import { parseSegments } from "@/engine/segments";
import type { SegmentHitResult } from "@/lib/geo/Segment";
import type { Segment as SegmentType } from "@/types/segments";

export type BoundingRectEdge = "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | null;

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

function pointInRect(p: Point2D, rect: Rect2D): boolean {
  return p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;
}

function findPointsInRect(
  points: PointSnapshot[],
  rect: Rect2D,
): PointSnapshot[] {
  return points.filter((p) => pointInRect(p, rect));
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
    const allPoints = getAllPoints(ctx.glyph);
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
      this.#editor.clearSelection();
      ctx.select.set(new Set([pointId]));
    }
  }

  selectPointsInRect(rect: Rect2D): RectSelectResult {
    const ctx = this.#editor.createToolContext();
    const allPoints = getAllPoints(ctx.glyph);
    const hitPoints = findPointsInRect(allPoints, rect);
    const pointIds = new Set(hitPoints.map((p) => asPointId(p.id)));
    this.#editor.clearSelection();
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
    const allPoints = getAllPoints(ctx.glyph);
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

    const segmentHit = hitTestSegments(ctx.glyph, pos, hitRadius);
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
    const hit = hitTestSegments(ctx.glyph, pos, hitRadius);

    if (!hit) return null;

    const segment = findSegmentById(ctx.glyph, hit.segmentId);
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
    const segment = findSegmentById(ctx.glyph, segmentId);

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

    const segment = findSegmentById(ctx.glyph, segmentId);
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
    return this.#editor.hoveredSegmentId.peek();
  }

  /**
   * Get the bounding rectangle of selected points.
   * Returns null if no points are selected or selection is in preview mode.
   */
  getSelectionBoundingRect(): Rect2D | null {
    const ctx = this.#editor.createToolContext();
    if (ctx.selectedPoints.size === 0) return null;
    if (ctx.selectionMode !== "committed") return null;

    const allPoints = getAllPoints(ctx.glyph);
    const selectedPoints = allPoints.filter((p) =>
      ctx.selectedPoints.has(asPointId(p.id)),
    );

    return Polygon.boundingRect(selectedPoints);
  }

  /**
   * Hit test against the edges of the bounding rectangle.
   * Returns which edge is being hovered, or null if not on any edge.
   */
  hitTestBoundingRectEdge(pos: Point2D): BoundingRectEdge {
    const rect = this.getSelectionBoundingRect();
    if (!rect) return null;

    const ctx = this.#editor.createToolContext();
    const tolerance = ctx.screen.hitRadius;

    const onLeft = Math.abs(pos.x - rect.left) < tolerance;
    const onRight = Math.abs(pos.x - rect.right) < tolerance;
    const onTop = Math.abs(pos.y - rect.top) < tolerance;
    const onBottom = Math.abs(pos.y - rect.bottom) < tolerance;

    const withinX = pos.x >= rect.left - tolerance && pos.x <= rect.right + tolerance;
    const withinY = pos.y >= rect.top - tolerance && pos.y <= rect.bottom + tolerance;

    // Check corners first (they take priority)
    if (onLeft && onTop) return "bottom-left";
    if (onRight && onTop) return "bottom-right";
    if (onLeft && onBottom) return "top-left";
    if (onRight && onBottom) return "top-right";

    // Check edges
    if (onLeft && withinY) return "left";
    if (onRight && withinY) return "right";
    if (onTop && withinX) return "top";
    if (onBottom && withinX) return "bottom";

    return null;
  }

  /**
   * Get the anchor point for a resize operation based on the edge being dragged.
   * Returns the opposite corner/center point that stays fixed during resize.
   */
  getAnchorPointForEdge(edge: Exclude<BoundingRectEdge, null>, rect: Rect2D): Point2D {
    const centerX = (rect.left + rect.right) / 2;
    const centerY = (rect.top + rect.bottom) / 2;

    switch (edge) {
      case "top-left":
        return { x: rect.right, y: rect.top };
      case "top-right":
        return { x: rect.left, y: rect.top };
      case "bottom-left":
        return { x: rect.right, y: rect.bottom };
      case "bottom-right":
        return { x: rect.left, y: rect.bottom };
      case "left":
        return { x: rect.right, y: centerY };
      case "right":
        return { x: rect.left, y: centerY };
      case "top":
        return { x: centerX, y: rect.bottom };
      case "bottom":
        return { x: centerX, y: rect.top };
    }
  }

  /**
   * Calculate scale factors based on edge being dragged and mouse position.
   */
  calculateScaleFactors(
    edge: Exclude<BoundingRectEdge, null>,
    currentPos: Point2D,
    anchorPoint: Point2D,
    initialBounds: Rect2D,
    uniform: boolean,
  ): { sx: number; sy: number } {
    const initialWidth = initialBounds.right - initialBounds.left;
    const initialHeight = initialBounds.bottom - initialBounds.top;

    if (initialWidth === 0 || initialHeight === 0) {
      return { sx: 1, sy: 1 };
    }

    const newWidth = Math.abs(currentPos.x - anchorPoint.x);
    const newHeight = Math.abs(currentPos.y - anchorPoint.y);

    let sx = 1;
    let sy = 1;

    const isCorner = edge.includes("-");
    const affectsX = edge === "left" || edge === "right" || isCorner;
    const affectsY = edge === "top" || edge === "bottom" || isCorner;

    if (affectsX) {
      sx = newWidth / initialWidth;
    }
    if (affectsY) {
      sy = newHeight / initialHeight;
    }

    if (uniform && isCorner) {
      const uniformScale = Math.max(sx, sy);
      sx = uniformScale;
      sy = uniformScale;
    }

    let flipX = false;
    let flipY = false;

    if (edge === "left" || edge === "top-left" || edge === "bottom-left") {
      flipX = currentPos.x > anchorPoint.x;
    } else if (edge === "right" || edge === "top-right" || edge === "bottom-right") {
      flipX = currentPos.x < anchorPoint.x;
    }

    if (edge === "top-left" || edge === "top-right") {
      flipY = currentPos.y < anchorPoint.y;
    } else if (edge === "bottom-left" || edge === "bottom-right") {
      flipY = currentPos.y > anchorPoint.y;
    } else if (edge === "top") {
      flipY = currentPos.y > anchorPoint.y;
    } else if (edge === "bottom") {
      flipY = currentPos.y < anchorPoint.y;
    }

    if (flipX) sx = -sx;
    if (flipY) sy = -sy;

    return { sx, sy };
  }

  /**
   * Apply a scale transformation to selected points around an anchor point.
   */
  scaleSelectedPoints(anchorPoint: Point2D, sx: number, sy: number): void {
    const ctx = this.#editor.createToolContext();
    if (ctx.selectedPoints.size === 0) return;

    const allPoints = getAllPoints(ctx.glyph);
    const selectedPointsData = allPoints.filter((p) =>
      ctx.selectedPoints.has(asPointId(p.id)),
    );

    const moves: Array<{ pointId: PointId; x: number; y: number }> = [];

    for (const point of selectedPointsData) {
      const newX = anchorPoint.x + (point.x - anchorPoint.x) * sx;
      const newY = anchorPoint.y + (point.y - anchorPoint.y) * sy;
      moves.push({ pointId: asPointId(point.id), x: newX, y: newY });
    }

    for (const move of moves) {
      ctx.edit.movePointTo(move.pointId, move.x, move.y);
    }
  }
}
