import { Point2D } from "@/types/math";

import { Tool, ToolName } from "../../types/tool";
import { Editor } from "../editor/Editor";

export class Select implements Tool {
  public readonly name: ToolName = "select";

  #editor: Editor;
  #startPos: Point2D;
  #dragging: boolean;

  public constructor(editor: Editor) {
    this.#editor = editor;
    this.#startPos = { x: 0, y: 0 };
    this.#dragging = false;
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    this.#dragging = true;
    this.#startPos = this.#editor.getMousePosition(e.clientX, e.clientY);
  }

  onMouseUp(_: React.MouseEvent<HTMLCanvasElement>): void {
    this.#dragging = false;
    this.#editor.setSelecting(false);
    this.#editor.requestRedraw();
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (!this.#dragging) return;
    const { x, y } = this.#editor.getMousePosition(e.clientX, e.clientY);

    const width = x - this.#startPos.x;
    const height = y - this.#startPos.y;

    this.#editor.setSelecting(true);
    this.#editor.setSelectionRect(
      this.#startPos.x,
      this.#startPos.y,
      width,
      height,
    );
    this.#editor.requestRedraw();
  }
}
