import { Editor } from '@/lib/editor/Editor';
import { UPMRect } from '@/lib/math/rect';
import { signal, effect, type WritableSignal, type Effect } from '@/lib/reactive/signal';
import { SELECTION_RECTANGLE_STYLES } from '@/lib/styles/style';
import { IRenderer } from '@/types/graphics';
import { Tool, ToolName } from '@/types/tool';

import { SelectCommands } from './commands';
import type { SelectState } from './states';

export class Select implements Tool {
  public readonly name: ToolName = 'select';

  #editor: Editor;
  #state: WritableSignal<SelectState>;
  #commands: SelectCommands;
  #selectionRect: UPMRect;
  #renderEffect: Effect;
  #shiftModifierOn: boolean = false;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#state = signal<SelectState>({ type: 'idle' });
    this.#commands = new SelectCommands(editor);
    this.#selectionRect = new UPMRect(0, 0, 0, 0);

    this.#renderEffect = effect(() => {
      const state = this.#state.value;
      if (state.type !== 'idle') {
        editor.requestRedraw();
      }
    });
  }

  setIdle(): void {
    this.#state.set({ type: 'idle' });
  }

  setReady(): void {
    this.#state.set({ type: 'ready', hoveredPointId: null });
  }

  dispose(): void {
    this.#renderEffect.dispose();
  }

  getState(): SelectState {
    return this.#state.value;
  }

  #getMouseUpm(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const screenPos = this.#editor.getMousePosition(e.clientX, e.clientY);
    return this.#editor.projectScreenToUpm(screenPos.x, screenPos.y);
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    const pos = this.#getMouseUpm(e);
    const { pointId } = this.#commands.hitTest(pos);
    const state = this.#state.value;

    switch (state.type) {
      case 'ready':
        if (pointId) {
          this.#commands.selectPoint(pointId, false);
          this.#state.set({
            type: 'dragging',
            drag: {
              anchorPointId: pointId,
              startPos: pos,
              totalDelta: { x: 0, y: 0 },
            },
          });
        } else {
          this.#editor.setSelectionMode('preview');
          this.#state.set({
            type: 'selecting',
            selection: { startPos: pos, currentPos: pos },
          });
        }
        break;

      case 'selected':
        if (pointId) {
          const isSelected = this.#commands.isPointSelected(pointId);
          if (this.#shiftModifierOn) {
            this.#commands.togglePointInSelection(pointId);
            if (this.#commands.hasSelection()) {
              this.#state.set({ type: 'selected', hoveredPointId: pointId });
            } else {
              this.#state.set({ type: 'ready', hoveredPointId: pointId });
            }
          } else {
            if (!isSelected) {
              this.#commands.selectPoint(pointId, false);
            }
            this.#state.set({
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
          this.#state.set({
            type: 'selecting',
            selection: { startPos: pos, currentPos: pos },
          });
        }
        break;
    }

    this.#editor.requestRedraw();
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    const pos = this.#getMouseUpm(e);
    const state = this.#state.value;

    switch (state.type) {
      case 'selecting': {
        const width = pos.x - state.selection.startPos.x;
        const height = pos.y - state.selection.startPos.y;
        this.#selectionRect.changeOrigin(state.selection.startPos.x, state.selection.startPos.y);
        this.#selectionRect.resize(width, height);
        this.#commands.selectPointsInRect(this.#selectionRect);
        this.#state.set({
          type: 'selecting',
          selection: { ...state.selection, currentPos: pos },
        });
        break;
      }

      case 'dragging': {
        const delta = this.#commands.moveSelectedPoints(state.drag.anchorPointId, pos);
        this.#state.set({
          type: 'dragging',
          drag: {
            ...state.drag,
            totalDelta: {
              x: state.drag.totalDelta.x + delta.x,
              y: state.drag.totalDelta.y + delta.y,
            },
          },
        });
        break;
      }

      case 'ready': {
        const { pointId } = this.#commands.hitTest(pos);
        this.#commands.updateHover(pos);
        this.#state.set({ type: 'ready', hoveredPointId: pointId });
        break;
      }

      case 'selected': {
        const { pointId } = this.#commands.hitTest(pos);
        this.#commands.updateHover(pos);
        this.#state.set({ type: 'selected', hoveredPointId: pointId });
        break;
      }
    }
  }

  onMouseUp(_e: React.MouseEvent<HTMLCanvasElement>): void {
    const state = this.#state.value;

    switch (state.type) {
      case 'selecting': {
        const { pointIds } = this.#commands.selectPointsInRect(this.#selectionRect);
        this.#selectionRect.clear();
        this.#editor.setSelectionMode('committed');

        if (pointIds.size > 0) {
          this.#state.set({ type: 'selected', hoveredPointId: null });
        } else {
          this.#state.set({ type: 'ready', hoveredPointId: null });
        }
        break;
      }

      case 'dragging':
        this.#state.set({ type: 'selected', hoveredPointId: null });
        break;
    }
  }

  drawInteractive(ctx: IRenderer): void {
    const state = this.#state.value;

    if (state.type === 'selecting') {
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
    }
  }

  keyDownHandler(e: KeyboardEvent): void {
    this.#shiftModifierOn = e.shiftKey;

    const state = this.#state.value;
    if (state.type !== 'selected') return;

    const modifier = e.metaKey ? 'large' : e.shiftKey ? 'medium' : 'small';
    const nudgeValue = this.#commands.getNudgeValue(modifier);

    switch (e.key) {
      case 'ArrowLeft':
        this.#commands.nudgeSelectedPoints(-nudgeValue, 0);
        this.#editor.requestRedraw();
        break;

      case 'ArrowRight':
        this.#commands.nudgeSelectedPoints(nudgeValue, 0);
        this.#editor.requestRedraw();
        break;

      case 'ArrowUp':
        this.#commands.nudgeSelectedPoints(0, nudgeValue);
        this.#editor.requestRedraw();
        break;

      case 'ArrowDown':
        this.#commands.nudgeSelectedPoints(0, -nudgeValue);
        this.#editor.requestRedraw();
        break;
    }
  }

  keyUpHandler(_e: KeyboardEvent): void {
    this.#shiftModifierOn = false;
  }

  onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>): void {
    const pos = this.#getMouseUpm(e);
    this.#commands.toggleSmooth(pos);
  }
}
