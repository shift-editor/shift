import { Editor } from '@/lib/editor/Editor';
import { IRenderer } from '@/types/graphics';
import { Point2D } from '@/types/math';
import { Tool, ToolName } from '@/types/tool';

import { EntityId } from '../core/EntityId';
import { Point } from '../math/point';
import { DEFAULT_STYLES } from '../styles/style';

interface AddedPoint {
  point: Point2D;
  entityId: EntityId;
}

export type PenState =
  | { type: 'ready' }
  | { type: 'idle' }
  | { type: 'dragging'; point: AddedPoint }
  | {
      type: 'draggingHandle';
      cornerPoint: Point2D;
      segmentId: EntityId;
      trailingPoint: Point2D;
    };

export class Pen implements Tool {
  public readonly name: ToolName = 'pen';

  #editor: Editor;
  #toolState: PenState;

  public constructor(editor: Editor) {
    this.#editor = editor;
    this.#toolState = { type: 'idle' };
  }

  setIdle(): void {
    this.#toolState = { type: 'idle' };
  }

  setReady(): void {
    this.#toolState = { type: 'ready' };
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (e.button !== 0) return;
    if (this.#toolState.type !== 'ready') return;

    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);
    const addedPointId = this.#editor.addPoint(x, y, 'onCurve');

    this.#toolState = {
      type: 'dragging',
      point: {
        point: { x, y },
        entityId: addedPointId,
      },
    };

    this.#editor.emit('points:added', { pointIds: [addedPointId] });
    this.#editor.requestRedraw();
  }

  onMouseUp(_: React.MouseEvent<HTMLCanvasElement>): void {
    // TODO: if we create a cubic, keep all the points here
    this.#toolState = { type: 'ready' };
    this.#editor.requestRedraw();
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);

    switch (this.#toolState.type) {
      case 'dragging':
        {
          const distance = Point.distance(
            this.#toolState.point.point.x,
            this.#toolState.point.point.y,
            x,
            y
          );

          if (this.#toolState.point.entityId && distance > 3) {
            const id = this.#editor.upgradeLineSegment(this.#toolState.point.entityId);

            this.#toolState = {
              type: 'draggingHandle',
              trailingPoint: { x, y },
              cornerPoint: this.#toolState.point.point,
              segmentId: id,
            };
          }
        }
        break;

      case 'draggingHandle': {
        this.#toolState = {
          ...this.#toolState,
          trailingPoint: { x, y },
        };

        const segment = this.#editor.getSegment(this.#toolState.segmentId);

        if (segment && segment.type === 'cubic') {
          const c2 = segment.points.control2;
          const anchorX = this.#toolState.cornerPoint.x;
          const anchorY = this.#toolState.cornerPoint.y;
          const oppositeX = 2 * anchorX - x;
          const oppositeY = 2 * anchorY - y;

          this.#editor.movePointTo(c2.entityId, oppositeX, oppositeY);
          this.#editor.redrawGlyph();
        }
      }
    }

    this.#editor.requestRedraw();
  }

  drawTrailingHandle(ctx: IRenderer, x: number, y: number) {
    this.#editor.paintHandle(ctx, x, y, 'control', 'idle');
  }

  drawInteractive(ctx: IRenderer): void {
    if (this.#toolState.type !== 'draggingHandle') return;

    ctx.setStyle({
      ...DEFAULT_STYLES,
    });

    ctx.beginPath();
    ctx.moveTo(this.#toolState.trailingPoint.x, this.#toolState.trailingPoint.y);
    ctx.lineTo(this.#toolState.cornerPoint.x, this.#toolState.cornerPoint.y);
    ctx.stroke();
    this.drawTrailingHandle(ctx, this.#toolState.trailingPoint.x, this.#toolState.trailingPoint.y);
  }
}
