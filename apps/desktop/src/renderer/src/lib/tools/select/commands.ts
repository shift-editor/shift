import type { Editor } from '@/lib/editor/Editor';
import { UPMRect } from '@/lib/math/rect';
import type { Point2D } from '@/types/math';
import type { PointId } from '@/types/ids';
import { asPointId } from '@/types/ids';
import type { PointSnapshot } from '@/types/generated';
import { NUDGES_VALUES, type NudgeMagnitude } from '@/types/nudge';
import { Vec2 } from '@/lib/geo';

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
    const { pointId } = this.hitTest(pos);
    ctx.select.setHovered(pointId);
  }

  toggleSmooth(pos: Point2D): boolean {
    const ctx = this.#editor.createToolContext();
    const { point, pointId } = this.hitTest(pos);
    if (point && pointId && point.pointType === 'onCurve') {
      ctx.edit.toggleSmooth(pointId);
      ctx.requestRedraw();
      return true;
    }
    return false;
  }
}
