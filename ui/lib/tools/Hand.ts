import { Point2D } from "@/types/math";
import { Tool, ToolName } from "@/types/tool";

import { Editor } from "../editor/Editor";

export class Hand implements Tool {
  public readonly name: ToolName = "hand";

  #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  #dragging: boolean = false;
  #startPos: Point2D = { x: 0, y: 0 };
  #startPan: Point2D = { x: 0, y: 0 };

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    this.#startPos = this.#editor.getMousePosition(e.clientX, e.clientY);
    this.#startPan = this.#editor.getPan();

    this.#dragging = true;
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (!this.#dragging) return;
    const { x, y } = this.#editor.getMousePosition(e.clientX, e.clientY);

    const dx = x - this.#startPos.x;
    const dy = y - this.#startPos.y;

    const panX = this.#startPan.x + dx;
    const panY = this.#startPan.y + dy;

    this.#editor.pan(panX, panY);
    this.#editor.requestRedraw();
  }

  onMouseUp(_: React.MouseEvent<HTMLCanvasElement>): void {
    this.#dragging = false;
    this.#editor.cancelRedraw();
  }
}
