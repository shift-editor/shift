import { ContourPoint } from '@/lib/core/Contour';
import { UPMRect } from '@/lib/math/rect';
import { SELECTION_RECTANGLE_STYLES } from '@/lib/styles/style';
import { EditSession } from '@/types/edit';
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

  #session: EditSession;
  #state: SelectState;
  #selectionRect: UPMRect;

  public constructor(session: EditSession) {
    this.#session = session;
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
    return this.#session.getAllPoints().filter(hitTest);
  }

  isPointSelected(point: ContourPoint): boolean {
    return this.#session.getSelectedPoints().includes(point);
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    const { x, y } = this.#session.getMousePosition(e.clientX, e.clientY);

    const hitPoints = this.gatherHitPoints((p) => p.distance(x, y) < 4);
    const firstHitPoint = hitPoints[0];

    switch (this.#state.type) {
      case 'ready':
        if (hitPoints.length === 1) {
          this.#state = { type: 'modifying', startPos: { x, y }, selectedPoint: firstHitPoint };
          this.#session.setSelectedPoints(hitPoints);
          break;
        }

        this.#state = { type: 'selecting', startPos: { x, y } };
        break;
      case 'modifying':
        if (hitPoints.length === 0) {
          this.#state = { type: 'ready' };
          this.#session.clearSelectedPoints();
          break;
        }

        if (!this.isPointSelected(firstHitPoint)) {
          if (this.#state.shiftModifierOn) {
            const selectedPoints = this.#session.getSelectedPoints();
            this.#session.setSelectedPoints([...selectedPoints, ...hitPoints]);
          } else {
            this.#session.clearSelectedPoints();
            this.#session.setSelectedPoints(hitPoints);
          }
        }

        this.#state = { type: 'modifying', startPos: { x, y }, selectedPoint: firstHitPoint };
        break;
    }

    this.#session.redraw();
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    const { x, y } = this.#session.getMousePosition(e.clientX, e.clientY);

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

      this.#session.preview(dx, dy);
      // this.#session.commit();
    }

    const hitPoints = this.gatherHitPoints((p) => p.distance(x, y) < 4);

    if (hitPoints.length > 0) {
      this.#session.setHoveredPoint(hitPoints[0]);
    } else {
      this.#session.clearHoveredPoint();
    }

    this.#session.redraw();
  }

  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {
    const { x, y } = this.#session.getMousePosition(e.clientX, e.clientY);

    if (this.#state.type === 'selecting') {
      const hitPoints = this.gatherHitPoints((p) => this.#selectionRect.hit(p.x, p.y));

      if (hitPoints.length === 0) {
        this.#state = { type: 'ready' };
      } else {
        this.#session.setSelectedPoints(hitPoints);
        this.#state = { type: 'modifying', startPos: { x, y } };
      }

      this.#selectionRect.clear();
    }

    if (this.#state.type === 'modifying' && this.#state.selectedPoint) {
      const dx = x - this.#state.startPos.x;
      const dy = y - this.#state.startPos.y;

      // this.#session.preview(dx, dy);
      // this.#session.commit(dx, dy);
      this.#state.selectedPoint = undefined;
    }

    this.#session.redraw();
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
        this.#session.preview(dx, dy);
        this.#session.commit(dx, dy);
        this.#session.redraw();
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
    const { x, y } = this.#session.getMousePosition(e.clientX, e.clientY);

    const hitPoints = this.gatherHitPoints((p) => p.distance(x, y) < 4);

    if (hitPoints.length === 1) {
      const point = hitPoints[0];

      if (point.pointType === 'onCurve') {
        point.toggleSmooth();
      }
    }
  }
}
