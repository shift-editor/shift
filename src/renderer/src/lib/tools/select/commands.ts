import type { Editor } from '@/lib/editor/Editor';
import { UPMRect } from '@/lib/math/rect';
import type { Point2D } from '@/types/math';
import type { PointId } from '@/types/ids';
import { asPointId } from '@/types/ids';
import type { PointSnapshot } from '@/types/generated';
import { NUDGES_VALUES, type NudgeMagnitude } from '@/types/nudge';
import { HIT_RADIUS } from './states';

function pointDistance(point: PointSnapshot, x: number, y: number): number {
  const dx = point.x - x;
  const dy = point.y - y;
  return Math.sqrt(dx * dx + dy * dy);
}

function findPointAtPosition(
  points: PointSnapshot[],
  x: number,
  y: number,
  hitRadius: number,
): PointSnapshot | null {
  for (const point of points) {
    if (pointDistance(point, x, y) < hitRadius) {
      return point;
    }
  }
  return null;
}

function findPointsInRect(points: PointSnapshot[], rect: UPMRect): PointSnapshot[] {
  return points.filter((p) => rect.hit(p.x, p.y));
}

function getAllPoints(snapshot: { contours: Array<{ points: PointSnapshot[] }> } | null): PointSnapshot[] {
  if (!snapshot) return [];
  const result: PointSnapshot[] = [];
  for (const contour of snapshot.contours) {
    result.push(...contour.points);
  }
  return result;
}

export interface HitTestResult {
  point: PointSnapshot | null;
  pointId: PointId | null;
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
    const hitPoint = findPointAtPosition(allPoints, pos.x, pos.y, HIT_RADIUS);

    if (hitPoint) {
      return { point: hitPoint, pointId: asPointId(hitPoint.id) };
    }
    return { point: null, pointId: null };
  }

  selectPoint(pointId: PointId, additive: boolean): void {
    if (additive) {
      const ctx = this.#editor.createToolContext();
      const newSelection = new Set(ctx.selectedPoints);
      newSelection.add(pointId);
      this.#editor.setSelectedPoints(newSelection);
    } else {
      this.#editor.setSelectedPoints(new Set([pointId]));
    }
  }

  selectPointsInRect(rect: UPMRect): RectSelectResult {
    const ctx = this.#editor.createToolContext();
    const allPoints = getAllPoints(ctx.snapshot);
    const hitPoints = findPointsInRect(allPoints, rect);
    const pointIds = new Set(hitPoints.map((p) => asPointId(p.id)));
    this.#editor.setSelectedPoints(pointIds);
    return { points: hitPoints, pointIds };
  }

  clearSelection(): void {
    this.#editor.clearSelectedPoints();
  }

  togglePointInSelection(pointId: PointId): void {
    const ctx = this.#editor.createToolContext();
    const newSelection = new Set(ctx.selectedPoints);
    if (newSelection.has(pointId)) {
      newSelection.delete(pointId);
    } else {
      newSelection.add(pointId);
    }
    this.#editor.setSelectedPoints(newSelection);
  }

  isPointSelected(pointId: PointId): boolean {
    const ctx = this.#editor.createToolContext();
    return ctx.selectedPoints.has(pointId);
  }

  hasSelection(): boolean {
    const ctx = this.#editor.createToolContext();
    return ctx.selectedPoints.size > 0;
  }

  moveSelectedPoints(anchorId: PointId, currentPos: Point2D): Point2D {
    const ctx = this.#editor.createToolContext();
    const allPoints = getAllPoints(ctx.snapshot);
    const dragPoint = allPoints.find((p) => p.id === anchorId);

    if (!dragPoint) {
      return { x: 0, y: 0 };
    }

    const dx = currentPos.x - dragPoint.x;
    const dy = currentPos.y - dragPoint.y;

    if (dx !== 0 || dy !== 0) {
      this.#editor.fontEngine.editEngine.applyEdits(ctx.selectedPoints, dx, dy);
    }

    return { x: dx, y: dy };
  }

  nudgeSelectedPoints(dx: number, dy: number): void {
    const ctx = this.#editor.createToolContext();
    if (ctx.selectedPoints.size > 0) {
      this.#editor.fontEngine.editEngine.applyEdits(ctx.selectedPoints, dx, dy);
    }
  }

  getNudgeValue(modifier: NudgeMagnitude): number {
    return NUDGES_VALUES[modifier];
  }

  updateHover(pos: Point2D): void {
    const { pointId } = this.hitTest(pos);
    if (pointId) {
      this.#editor.setHoveredPoint(pointId);
    } else {
      this.#editor.clearHoveredPoint();
    }
  }

  toggleSmooth(pos: Point2D): boolean {
    const { point, pointId } = this.hitTest(pos);
    if (point && point.pointType === 'onCurve' && pointId) {
      this.#editor.fontEngine.editing.toggleSmooth(pointId);
      this.#editor.requestRedraw();
      return true;
    }
    return false;
  }
}
