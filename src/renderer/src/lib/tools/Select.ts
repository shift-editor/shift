import { Editor } from '@/lib/editor/Editor';
import { UPMRect } from '@/lib/math/rect';
import { SELECTION_RECTANGLE_STYLES } from '@/lib/styles/style';
import { IRenderer } from '@/types/graphics';
import { Point2D } from '@/types/math';
import { NUDGES_VALUES } from '@/types/nudge';
import { Tool, ToolName } from '@/types/tool';
import type { PointId } from '@/types/ids';
import { asPointId } from '@/types/ids';
import type { PointSnapshot } from '@/types/generated';

/**
 * Calculate distance between a point and coordinates.
 */
function pointDistance(point: PointSnapshot, x: number, y: number): number {
  const dx = point.x - x;
  const dy = point.y - y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Find point at position with given hit radius.
 */
function findPointAtPosition(
  points: PointSnapshot[],
  x: number,
  y: number,
  hitRadius: number
): PointSnapshot | null {
  for (const point of points) {
    if (pointDistance(point, x, y) < hitRadius) {
      return point;
    }
  }
  return null;
}

/**
 * Find all points within a rectangle.
 */
function findPointsInRect(
  points: PointSnapshot[],
  rect: UPMRect
): PointSnapshot[] {
  return points.filter((p) => rect.hit(p.x, p.y));
}

/**
 * Get all points from a snapshot.
 */
function getAllPoints(snapshot: { contours: Array<{ points: PointSnapshot[] }> } | null): PointSnapshot[] {
  if (!snapshot) return [];
  const result: PointSnapshot[] = [];
  for (const contour of snapshot.contours) {
    result.push(...contour.points);
  }
  return result;
}

export type SelectState =
  | { type: 'idle' }
  | { type: 'ready' }
  | { type: 'selecting'; startPos: Point2D }
  | {
      type: 'modifying';
      startPos: Point2D;
      /** The point being dragged (if any) */
      dragPointId?: PointId;
      /** Original position of drag point for delta calculation */
      dragPointOriginalPos?: Point2D;
      shiftModifierOn?: boolean;
    };

export class Select implements Tool {
  public readonly name: ToolName = 'select';

  #editor: Editor;
  #state: SelectState;
  #selectionRect: UPMRect;

  public constructor(editor: Editor) {
    this.#editor = editor;
    this.#state = { type: 'idle' };
    this.#selectionRect = new UPMRect(0, 0, 0, 0);
  }

  setIdle(): void {
    this.#state = { type: 'idle' };
  }

  setReady(): void {
    this.#state = { type: 'ready' };
  }

  #getMouseUpm(e: React.MouseEvent<HTMLCanvasElement>): Point2D {
    const screenPos = this.#editor.getMousePosition(e.clientX, e.clientY);
    return this.#editor.projectScreenToUpm(screenPos.x, screenPos.y);
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    const { x, y } = this.#getMouseUpm(e);
    const ctx = this.#editor.createToolContext();
    const allPoints = getAllPoints(ctx.snapshot);

    const hitPoint = findPointAtPosition(allPoints, x, y, 4);

    switch (this.#state.type) {
      case 'ready':
        if (hitPoint) {
          const pointId = asPointId(hitPoint.id);
          this.#state = {
            type: 'modifying',
            startPos: { x, y },
            dragPointId: pointId,
            dragPointOriginalPos: { x: hitPoint.x, y: hitPoint.y },
          };
          this.#editor.setSelectedPoints(new Set([pointId]));
          break;
        }

        this.#state = { type: 'selecting', startPos: { x, y } };
        break;

      case 'modifying':
        if (!hitPoint) {
          this.#state = { type: 'ready' };
          this.#editor.clearSelectedPoints();
          break;
        }

        const pointId = asPointId(hitPoint.id);
        if (!ctx.selectedPoints.has(pointId)) {
          if (this.#state.shiftModifierOn) {
            // Add to selection
            const newSelection = new Set(ctx.selectedPoints);
            newSelection.add(pointId);
            this.#editor.setSelectedPoints(newSelection);
          } else {
            // Replace selection
            this.#editor.setSelectedPoints(new Set([pointId]));
          }
        }

        this.#state = {
          type: 'modifying',
          startPos: { x, y },
          dragPointId: pointId,
          dragPointOriginalPos: { x: hitPoint.x, y: hitPoint.y },
          shiftModifierOn: this.#state.shiftModifierOn,
        };
        break;
    }

    this.#editor.requestRedraw();
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    const { x, y } = this.#getMouseUpm(e);
    const ctx = this.#editor.createToolContext();
    const allPoints = getAllPoints(ctx.snapshot);

    if (this.#state.type === 'selecting') {
      const width = x - this.#state.startPos.x;
      const height = y - this.#state.startPos.y;

      this.#selectionRect.changeOrigin(this.#state.startPos.x, this.#state.startPos.y);
      this.#selectionRect.resize(width, height);
    }

    // Move selected points
    if (this.#state.type === 'modifying' && this.#state.dragPointOriginalPos) {
      const dx = x - this.#state.dragPointOriginalPos.x;
      const dy = y - this.#state.dragPointOriginalPos.y;

      // Move all selected points by delta
      const selectedIds = Array.from(ctx.selectedPoints);
      if (selectedIds.length > 0) {
        this.#editor.fontEngine.editing.movePoints(selectedIds, dx, dy);
      }
    }

    // Update hover state
    const hitPoint = findPointAtPosition(allPoints, x, y, 4);
    if (hitPoint) {
      this.#editor.setHoveredPoint(asPointId(hitPoint.id));
    } else {
      this.#editor.clearHoveredPoint();
    }

    this.#editor.requestRedraw();
  }

  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {
    const { x, y } = this.#getMouseUpm(e);
    const ctx = this.#editor.createToolContext();
    const allPoints = getAllPoints(ctx.snapshot);

    if (this.#state.type === 'selecting') {
      const hitPoints = findPointsInRect(allPoints, this.#selectionRect);

      if (hitPoints.length === 0) {
        this.#state = { type: 'ready' };
      } else {
        const selectedIds = new Set(hitPoints.map((p) => asPointId(p.id)));
        this.#editor.setSelectedPoints(selectedIds);
        this.#state = { type: 'modifying', startPos: { x, y } };
      }

      this.#selectionRect.clear();
    }

    if (this.#state.type === 'modifying') {
      // Clear drag state but stay in modifying mode
      this.#state = {
        ...this.#state,
        dragPointId: undefined,
        dragPointOriginalPos: undefined,
      };
    }

    this.#editor.requestRedraw();
  }

  drawInteractive(ctx: IRenderer): void {
    switch (this.#state.type) {
      case 'selecting':
        ctx.setStyle(SELECTION_RECTANGLE_STYLES);
        ctx.fillRect(
          this.#selectionRect.x,
          this.#selectionRect.y,
          this.#selectionRect.width,
          this.#selectionRect.height
        );

        ctx.setStyle(SELECTION_RECTANGLE_STYLES);
        ctx.strokeRect(
          this.#selectionRect.x,
          this.#selectionRect.y,
          this.#selectionRect.width,
          this.#selectionRect.height
        );
        break;
    }
  }

  keyDownHandler(e: KeyboardEvent) {
    if (this.#state.type === 'modifying') {
      this.#state.shiftModifierOn = e.shiftKey;
      const modifier = e.metaKey ? 'large' : e.shiftKey ? 'medium' : 'small';
      const nudgeValue = NUDGES_VALUES[modifier];

      const ctx = this.#editor.createToolContext();
      const selectedIds = Array.from(ctx.selectedPoints);

      const nudge = (dx: number, dy: number) => {
        if (selectedIds.length > 0) {
          this.#editor.fontEngine.editing.movePoints(selectedIds, dx, dy);
          this.#editor.requestRedraw();
        }
      };

      switch (e.key) {
        case 'ArrowLeft':
          nudge(-nudgeValue, 0);
          break;

        case 'ArrowRight':
          nudge(nudgeValue, 0);
          break;

        case 'ArrowUp':
          nudge(0, nudgeValue);
          break;

        case 'ArrowDown':
          nudge(0, -nudgeValue);
          break;
      }
    }
  }

  keyUpHandler(_: KeyboardEvent) {
    if (this.#state.type === 'modifying') {
      this.#state.shiftModifierOn = false;
    }
  }

  onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>): void {
    const { x, y } = this.#getMouseUpm(e);
    const ctx = this.#editor.createToolContext();
    const allPoints = getAllPoints(ctx.snapshot);

    const hitPoint = findPointAtPosition(allPoints, x, y, 4);

    if (hitPoint && hitPoint.pointType === 'onCurve') {
      // TODO: Toggle smooth via FontEngine
      // For now, this is a no-op since we need a Rust command for this
      console.log('Toggle smooth not yet implemented via FontEngine');
    }
  }
}
