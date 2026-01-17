import { Editor } from '@/lib/editor/Editor';
import { MovePointsCommand } from '@/lib/commands/PointCommands';
import { NudgePointsCommand } from '@/lib/commands/BezierCommands';
import { UPMRect } from '@/lib/math/rect';
import { effect, type Effect } from '@/lib/reactive/signal';
import { SELECTION_RECTANGLE_STYLES } from '@/lib/styles/style';
import { createStateMachine, type StateMachine } from '@/lib/tools/core';
import { IRenderer } from '@/types/graphics';
import { Tool, ToolName } from '@/types/tool';
import type { PointId } from '@/types/ids';

import { SelectCommands } from './commands';
import type { SelectState } from './states';

export class Select implements Tool {
  public readonly name: ToolName = 'select';

  #editor: Editor;
  #sm: StateMachine<SelectState>;
  #commands: SelectCommands;
  #selectionRect: UPMRect;
  #renderEffect: Effect;
  #shiftModifierOn: boolean = false;
  #draggedPointIds: PointId[] = [];

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#sm = createStateMachine<SelectState>({ type: 'idle' });
    this.#commands = new SelectCommands(editor);
    this.#selectionRect = new UPMRect(0, 0, 0, 0);

    this.#renderEffect = effect(() => {
      if (!this.#sm.isIn('idle')) {
        editor.requestRedraw();
      }
    });
  }

  setIdle(): void {
    this.#sm.transition({ type: 'idle' });
  }

  setReady(): void {
    this.#sm.transition({ type: 'ready', hoveredPointId: null });
  }

  dispose(): void {
    this.#renderEffect.dispose();
  }

  getState(): SelectState {
    return this.#sm.current;
  }

  #getMouseUpm(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const screenPos = this.#editor.getMousePosition(e.clientX, e.clientY);
    return this.#editor.projectScreenToUpm(screenPos.x, screenPos.y);
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    const pos = this.#getMouseUpm(e);
    const { pointId } = this.#commands.hitTest(pos);

    this.#sm.when('ready', () => {
      if (pointId) {
        this.#commands.selectPoint(pointId, false);
        // Track selected points for undo
        const ctx = this.#editor.createToolContext();
        this.#draggedPointIds = [...ctx.selectedPoints];
        this.#sm.transition({
          type: 'dragging',
          drag: {
            anchorPointId: pointId,
            startPos: pos,
            totalDelta: { x: 0, y: 0 },
          },
        });
      } else {
        this.#editor.setSelectionMode('preview');
        this.#sm.transition({
          type: 'selecting',
          selection: { startPos: pos, currentPos: pos },
        });
      }
    });

    this.#sm.when('selected', () => {
      if (pointId) {
        const isSelected = this.#commands.isPointSelected(pointId);
        if (this.#shiftModifierOn) {
          this.#commands.togglePointInSelection(pointId);
          if (this.#commands.hasSelection()) {
            this.#sm.transition({ type: 'selected', hoveredPointId: pointId });
          } else {
            this.#sm.transition({ type: 'ready', hoveredPointId: pointId });
          }
        } else {
          if (!isSelected) {
            this.#commands.selectPoint(pointId, false);
          }
          // Track selected points for undo
          const ctx = this.#editor.createToolContext();
          this.#draggedPointIds = [...ctx.selectedPoints];
          this.#sm.transition({
            type: 'dragging',
            drag: {
              anchorPointId: pointId,
              startPos: pos,
              totalDelta: { x: 0, y: 0 },
            },
          });
        }
      } else {
        this.#commands.clearSelection();
        this.#editor.setSelectionMode('preview');
        this.#sm.transition({
          type: 'selecting',
          selection: { startPos: pos, currentPos: pos },
        });
      }
    });

    this.#editor.requestRedraw();
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    const pos = this.#getMouseUpm(e);

    this.#sm.when('selecting', (state) => {
      const width = pos.x - state.selection.startPos.x;
      const height = pos.y - state.selection.startPos.y;
      this.#selectionRect.changeOrigin(state.selection.startPos.x, state.selection.startPos.y);
      this.#selectionRect.resize(width, height);
      this.#commands.selectPointsInRect(this.#selectionRect);
      this.#sm.transition({
        type: 'selecting',
        selection: { ...state.selection, currentPos: pos },
      });
    });

    this.#sm.when('dragging', (state) => {
      const delta = this.#commands.moveSelectedPoints(state.drag.anchorPointId, pos);
      this.#sm.transition({
        type: 'dragging',
        drag: {
          ...state.drag,
          totalDelta: {
            x: state.drag.totalDelta.x + delta.x,
            y: state.drag.totalDelta.y + delta.y,
          },
        },
      });
    });

    this.#sm.when('ready', () => {
      const { pointId } = this.#commands.hitTest(pos);
      this.#commands.updateHover(pos);
      this.#sm.transition({ type: 'ready', hoveredPointId: pointId });
    });

    this.#sm.when('selected', () => {
      const { pointId } = this.#commands.hitTest(pos);
      this.#commands.updateHover(pos);
      this.#sm.transition({ type: 'selected', hoveredPointId: pointId });
    });
  }

  onMouseUp(_e: React.MouseEvent<HTMLCanvasElement>): void {
    this.#sm.when('selecting', () => {
      const { pointIds } = this.#commands.selectPointsInRect(this.#selectionRect);
      this.#selectionRect.clear();
      this.#editor.setSelectionMode('committed');

      if (pointIds.size > 0) {
        this.#sm.transition({ type: 'selected', hoveredPointId: null });
      } else {
        this.#sm.transition({ type: 'ready', hoveredPointId: null });
      }
    });

    this.#sm.when('dragging', (state) => {
      const { totalDelta } = state.drag;

      // Record the move for undo if there was actual movement
      if ((totalDelta.x !== 0 || totalDelta.y !== 0) && this.#draggedPointIds.length > 0) {
        const cmd = new MovePointsCommand(this.#draggedPointIds, totalDelta.x, totalDelta.y);
        this.#editor.commandHistory.record(cmd);
      }

      this.#draggedPointIds = [];
      this.#sm.transition({ type: 'selected', hoveredPointId: null });
    });
  }

  drawInteractive(ctx: IRenderer): void {
    this.#sm.when('selecting', () => {
      ctx.setStyle(SELECTION_RECTANGLE_STYLES);
      ctx.fillRect(
        this.#selectionRect.x,
        this.#selectionRect.y,
        this.#selectionRect.width,
        this.#selectionRect.height,
      );

      ctx.setStyle(SELECTION_RECTANGLE_STYLES);
      ctx.strokeRect(
        this.#selectionRect.x,
        this.#selectionRect.y,
        this.#selectionRect.width,
        this.#selectionRect.height,
      );
    });
  }

  keyDownHandler(e: KeyboardEvent): void {
    this.#shiftModifierOn = e.shiftKey;

    if (!this.#sm.isIn('selected')) return;

    const modifier = e.metaKey ? 'large' : e.shiftKey ? 'medium' : 'small';
    const nudgeValue = this.#commands.getNudgeValue(modifier);
    const ctx = this.#editor.createToolContext();
    const pointIds = [...ctx.selectedPoints];

    if (pointIds.length === 0) return;

    let dx = 0;
    let dy = 0;

    switch (e.key) {
      case 'ArrowLeft':
        dx = -nudgeValue;
        break;
      case 'ArrowRight':
        dx = nudgeValue;
        break;
      case 'ArrowUp':
        dy = nudgeValue;
        break;
      case 'ArrowDown':
        dy = -nudgeValue;
        break;
      default:
        return;
    }

    const cmd = new NudgePointsCommand(pointIds, dx, dy);
    this.#editor.commandHistory.execute(cmd);
    this.#editor.requestRedraw();
  }

  keyUpHandler(_e: KeyboardEvent): void {
    this.#shiftModifierOn = false;
  }

  onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>): void {
    const pos = this.#getMouseUpm(e);
    this.#commands.toggleSmooth(pos);
  }
}
