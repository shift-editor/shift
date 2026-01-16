import { Editor } from '@/lib/editor/Editor';
import { DEFAULT_STYLES } from '@/lib/styles/style';
import { IRenderer } from '@/types/graphics';
import { Point2D, Rect2D } from '@/types/math';
import { Tool, ToolName } from '@/types/tool';

export type ShapeState =
  | { type: 'idle' }
  | { type: 'ready' }
  | { type: 'dragging'; startPos: Point2D };

export class Shape implements Tool {
  public readonly name: ToolName = 'shape';
  #editor: Editor;
  #state: ShapeState;
  #rect: Rect2D;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#state = { type: 'idle' };
    this.#rect = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
    };
  }

  setIdle(): void {
    this.#state = { type: 'idle' };
  }

  setReady(): void {
    this.#state = { type: 'ready' };
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);
    this.#state = { type: 'dragging', startPos: { x, y } };
  }

  onMouseUp(_: React.MouseEvent<HTMLCanvasElement>): void {
    this.#state = { type: 'ready' };

    const pointIds = [];

    pointIds.push(this.#editor.addPoint(this.#rect.x, this.#rect.y, 'onCurve'));
    pointIds.push(this.#editor.addPoint(this.#rect.x + this.#rect.width, this.#rect.y, 'onCurve'));
    pointIds.push(
      this.#editor.addPoint(
        this.#rect.x + this.#rect.width,
        this.#rect.y + this.#rect.height,
        'onCurve'
      )
    );
    pointIds.push(this.#editor.addPoint(this.#rect.x, this.#rect.y + this.#rect.height, 'onCurve'));
    this.#editor.closeContour();

    this.#editor.emit('points:added', { pointIds });
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (this.#state.type !== 'dragging') return;

    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);

    const width = x - this.#state.startPos.x;
    const height = y - this.#state.startPos.y;

    this.#rect = {
      x: this.#state.startPos.x,
      y: this.#state.startPos.y,
      width,
      height,
      left: this.#state.startPos.x,
      top: this.#state.startPos.y,
      right: this.#state.startPos.x + width,
      bottom: this.#state.startPos.y + height,
    };

    this.#editor.requestRedraw();
  }

  drawInteractive(ctx: IRenderer): void {
    if (this.#state.type !== 'dragging') return;

    ctx.setStyle({
      ...DEFAULT_STYLES,
      fillStyle: 'transparent',
    });

    ctx.strokeRect(this.#rect.x, this.#rect.y, this.#rect.width, this.#rect.height);
  }
}
