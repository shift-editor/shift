import { Editor } from '@/lib/editor/Editor';
import { Vec2 } from '@/lib/geo';
import { effect, type Effect } from '@/lib/reactive/signal';
import { createStateMachine, type StateMachine } from '@/lib/tools/core';
import { IRenderer } from '@/types/graphics';
import { Tool, ToolName } from '@/types/tool';
import type { ContourSnapshot, PointSnapshot } from '@/types/generated';

import { DEFAULT_STYLES } from '../../styles/style';
import { PenCommands } from './commands';
import {
  type ContourContext,
  type PenState,
  CLOSE_HIT_RADIUS,
  DRAG_THRESHOLD,
} from './states';

function getFirstPoint(contour: ContourSnapshot): PointSnapshot | null {
  return contour.points.length > 0 ? contour.points[0] : null;
}

function isNearPoint(pos: { x: number; y: number }, point: PointSnapshot, radius: number): boolean {
  return Vec2.dist(pos, point) < radius;
}

export class Pen implements Tool {
  public readonly name: ToolName = 'pen';

  #editor: Editor;
  #sm: StateMachine<PenState>;
  #commands: PenCommands;
  #renderEffect: Effect;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#sm = createStateMachine<PenState>({ type: 'idle' });
    this.#commands = new PenCommands(editor);

    this.#renderEffect = effect(() => {
      if (this.#sm.isIn('dragging', 'ready')) {
        editor.requestRedraw();
      }
    });
  }

  setIdle(): void {
    this.#sm.transition({ type: 'idle' });
  }

  setReady(): void {
    this.#sm.transition({ type: 'ready' });
  }

  dispose(): void {
    this.#renderEffect.dispose();
  }

  getState(): PenState {
    return this.#sm.current;
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (e.button !== 0) return;
    if (!this.#sm.isIn('ready')) return;

    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);
    const ctx = this.#editor.createToolContext();

    if (this.shouldCloseContour(x, y)) {
      ctx.commands.beginBatch('Close Contour');
      this.#commands.closeContour();
      ctx.commands.endBatch();
      return;
    }

    ctx.commands.beginBatch('Add Point');

    const context = this.buildContourContext();

    const result = this.#commands.placeAnchor({ x, y });

    this.#sm.transition({
      type: 'anchored',
      anchor: {
        position: { x, y },
        pointId: result.pointId,
        context,
      },
    });
  }

  onMouseUp(_e: React.MouseEvent<HTMLCanvasElement>): void {
    const ctx = this.#editor.createToolContext();
    if (this.#sm.isIn('anchored', 'dragging')) {
      if (ctx.commands.isBatching) {
        ctx.commands.endBatch();
      }
      this.#sm.transition({ type: 'ready' });
    }
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const mousePos = this.#editor.projectScreenToUpm(position.x, position.y);

    this.#sm.when('anchored', (state) => {
      const { anchor } = state;
      const dist = Vec2.dist(anchor.position, mousePos);

      if (dist > DRAG_THRESHOLD) {
        const result = this.#commands.createHandles(anchor, mousePos);

        this.#sm.transition({
          type: 'dragging',
          anchor,
          handles: result.handles,
          mousePos,
        });
      }
    });

    this.#sm.when('dragging', (state) => {
      const { anchor, handles } = state;

      this.#commands.updateHandles(anchor, handles, mousePos);

      this.#sm.transition({
        ...state,
        mousePos,
      });
    });
  }

  private buildContourContext(): ContourContext {
    const ctx = this.#editor.createToolContext();
    const snapshot = ctx.snapshot;
    if (!snapshot) {
      return {
        previousPointType: 'none',
        previousOnCurvePosition: null,
        isFirstPoint: true,
      };
    }

    const activeContourId = ctx.edit.getActiveContourId();
    const activeContour = snapshot.contours.find((c) => c.id === activeContourId);
    if (!activeContour || activeContour.points.length === 0) {
      return {
        previousPointType: 'none',
        previousOnCurvePosition: null,
        isFirstPoint: true,
      };
    }

    const points = activeContour.points;
    const lastPoint = points[points.length - 1];

    let previousOnCurvePosition: { x: number; y: number } | null = null;
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].pointType === 'onCurve') {
        previousOnCurvePosition = { x: points[i].x, y: points[i].y };
        break;
      }
    }

    return {
      previousPointType: lastPoint.pointType === 'offCurve' ? 'offCurve' : 'onCurve',
      previousOnCurvePosition,
      isFirstPoint: false,
    };
  }

  private shouldCloseContour(x: number, y: number): boolean {
    const ctx = this.#editor.createToolContext();
    const snapshot = ctx.snapshot;
    const activeContourId = ctx.edit.getActiveContourId();
    const activeContour = snapshot?.contours.find((c) => c.id === activeContourId);

    if (!activeContour || activeContour.closed || activeContour.points.length < 2) {
      return false;
    }

    const firstPoint = getFirstPoint(activeContour);
    return firstPoint !== null && isNearPoint({ x, y }, firstPoint, CLOSE_HIT_RADIUS);
  }

  drawInteractive(ctx: IRenderer): void {
    this.#sm.when('dragging', (state) => {
      const { anchor, mousePos } = state;

      ctx.setStyle({
        ...DEFAULT_STYLES,
      });

      const anchorX = anchor.position.x;
      const anchorY = anchor.position.y;
      const mouseX = mousePos.x;
      const mouseY = mousePos.y;

      const mirrorPos = Vec2.mirror(mousePos, anchor.position);

      ctx.beginPath();
      ctx.moveTo(mouseX, mouseY);
      ctx.lineTo(anchorX, anchorY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(anchorX, anchorY);
      ctx.lineTo(mirrorPos.x, mirrorPos.y);
      ctx.stroke();

      this.drawHandle(ctx, mouseX, mouseY);
      this.drawHandle(ctx, mirrorPos.x, mirrorPos.y);
    });
  }

  private drawHandle(ctx: IRenderer, x: number, y: number): void {
    this.#editor.paintHandle(ctx, x, y, 'control', 'idle');
  }
}
