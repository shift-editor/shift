import { PointsMovedEvent } from '@shift/shared';

import { ContourPoint } from '@/lib/core/Contour';
import { Editor } from '@/lib/editor/Editor';
import { UPMRect } from '@/lib/math/rect';
import { SELECTION_RECTANGLE_STYLES } from '@/lib/styles/style';
import { IRenderer } from '@/types/graphics';
import { Point2D } from '@/types/math';
import { NUDGES_VALUES } from '@/types/nudge';
import { Tool, ToolName } from '@/types/tool';

export type SelectState =
  | { type: 'idle' }
  | { type: 'ready' }
  | { type: 'selecting'; startPos: Point2D }
  | {
      type: 'modifying';
      startPos: Point2D;
      selectedPoint?: ContourPoint;
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

  gatherHitPoints(hitTest: (p: ContourPoint) => boolean): ContourPoint[] {
    return this.#editor.getAllPoints().filter(hitTest);
  }

  commitHitPoints(hitPoints: ContourPoint[]): void {
    hitPoints.map((p) => this.#editor.addToSelectedPoints(p));
  }

  moveSelectedPoints(dx: number, dy: number): void {
    // TODO: handle smooth points
    const selectedPoints = this.#editor.selectedPoints;
    const selectedPoint = selectedPoints[0];

    // moving an onCurve point with offCurve neighbors should move
    // those neighbors as well
    if (selectedPoints.length === 1) {
      const neighbors = this.#editor.getNeighborPoints(selectedPoint);

      switch (selectedPoint.pointType) {
        case 'onCurve': {
          const points = neighbors.filter((p) => p.pointType === 'offCurve');
          for (const p of points) {
            this.#editor.movePointBy(p.entityId, dx, dy);
          }
          break;
        }

        case 'offCurve': {
          // if the anchor is smooth, we need to move the control points
          const anchor = neighbors.find((p) => p.pointType === 'onCurve')!;
          const oppositeControlPoint = this.#editor
            .getNeighborPoints(anchor)
            .find((p) => p.pointType == 'offCurve' && p !== selectedPoint);

          if (anchor.smooth && oppositeControlPoint) {
            const newSelectedX = selectedPoint.x + dx;
            const newSelectedY = selectedPoint.y + dy;

            const selectedVector = {
              x: newSelectedX - anchor.x,
              y: newSelectedY - anchor.y,
            };

            const originalMagnitude = Math.hypot(
              oppositeControlPoint.x - anchor.x,
              oppositeControlPoint.y - anchor.y
            );

            const magnitude = Math.hypot(selectedVector.x, selectedVector.y);
            const unitX = -selectedVector.x / magnitude;
            const unitY = -selectedVector.y / magnitude;

            const newOppositeX = anchor.x + unitX * originalMagnitude;
            const newOppositeY = anchor.y + unitY * originalMagnitude;

            this.#editor.movePointTo(oppositeControlPoint.entityId, newOppositeX, newOppositeY);
          }
          break;
        }
      }

      this.#editor.movePointBy(selectedPoint.entityId, dx, dy);

      return;
    }

    for (const point of selectedPoints) {
      this.#editor.movePointBy(point.entityId, dx, dy);
    }
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);

    // TODO:  this could return multiple values if the points are very close
    //        we need to think about how to handle this
    const hitPoints = this.gatherHitPoints((p) => p.distance(x, y) < 4);
    const firstHitPoint = hitPoints[0];

    switch (this.#state.type) {
      case 'ready':
        if (hitPoints.length === 1) {
          this.#state = { type: 'modifying', startPos: { x, y }, selectedPoint: firstHitPoint };
          this.commitHitPoints(hitPoints);
          break;
        }

        this.#state = { type: 'selecting', startPos: { x, y } };
        break;
      case 'modifying':
        if (hitPoints.length === 0) {
          this.#state = { type: 'ready' };
          this.#editor.clearSelectedPoints();
          break;
        }

        if (!this.#editor.isPointSelected(firstHitPoint)) {
          if (this.#state.shiftModifierOn) {
            this.commitHitPoints(hitPoints);
          } else {
            this.#editor.clearSelectedPoints();
            this.commitHitPoints(hitPoints);
          }
        }

        this.#state = { type: 'modifying', startPos: { x, y }, selectedPoint: firstHitPoint };
        break;
    }

    this.#editor.requestRedraw();
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);

    if (this.#state.type === 'selecting') {
      const width = x - this.#state.startPos.x;
      const height = y - this.#state.startPos.y;

      this.#selectionRect.changeOrigin(this.#state.startPos.x, this.#state.startPos.y);
      this.#selectionRect.resize(width, height);
    }

    // move the point, if it's an active handle move all points by delta
    // otherwise we need to move proportional to an anchor point
    if (this.#state.type === 'modifying' && this.#state.selectedPoint) {
      const dx = x - this.#state.selectedPoint.x;
      const dy = y - this.#state.selectedPoint.y;

      this.moveSelectedPoints(dx, dy);
    }

    const hitPoints = this.gatherHitPoints((p) => p.distance(x, y) < 4);

    if (hitPoints.length > 0) {
      this.#editor.setHoveredPoint(hitPoints[0]);
    } else {
      this.#editor.clearHoveredPoint();
    }

    this.#editor.redrawGlyph();
  }

  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {
    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);

    if (this.#state.type === 'selecting') {
      const hitPoints = this.gatherHitPoints((p) => this.#selectionRect.hit(p.x, p.y));

      if (hitPoints.length === 0) {
        this.#state = { type: 'ready' };
      } else {
        this.commitHitPoints(hitPoints);
        this.#state = { type: 'modifying', startPos: { x, y } };
      }

      this.#selectionRect.clear();
    }

    if (this.#state.type === 'modifying' && this.#state.selectedPoint) {
      const dx = x - this.#state.startPos.x;
      const dy = y - this.#state.startPos.y;

      const commitMove = (dx: number, dy: number) => {
        this.#editor.emit<PointsMovedEvent>('points:moved', {
          points: this.#editor.selectedPoints.map((p) => ({
            pointId: p.entityId,
            fromX: p.x - dx,
            fromY: p.y - dy,
            toX: p.x,
            toY: p.y,
          })),
        });
      };

      commitMove(dx, dy);

      this.#state.selectedPoint = undefined;
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

      const nudge = (dx: number, dy: number) => {
        this.moveSelectedPoints(dx, dy);
        this.#editor.emit<PointsMovedEvent>('points:moved', {
          points: this.#editor.selectedPoints.map((p) => ({
            pointId: p.entityId,
            fromX: p.x - dx,
            fromY: p.y - dy,
            toX: p.x,
            toY: p.y,
          })),
        });
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
    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);

    const hitPoints = this.gatherHitPoints((p) => p.distance(x, y) < 4);

    if (hitPoints.length === 1) {
      const point = hitPoints[0];
      const segment = this.#editor.getSegment(point.entityId);
      if (!segment) return;

      // need to handle the case where this corner is wedged between two segments
      // one of which is a cubic and line or two cubics
      if (point.pointType === 'onCurve') {
        point.toggleSmooth();
      }
    }
  }
}
