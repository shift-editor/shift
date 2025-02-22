import { IRenderer } from "@/types/graphics";
import { Point2D, Rect2D } from "@/types/math";

import { Tool, ToolName, ToolState } from "../../types/tool";
import { Editor } from "../editor/Editor";
import { SELECTION_RECTANGLE_STYLES } from "../styles/style";

export class Select implements Tool {
  public readonly name: ToolName = "select";

  #editor: Editor;
  #startPos: Point2D;
  #state: ToolState;
  #selectionRect: Rect2D;

  public constructor(editor: Editor) {
    this.#editor = editor;
    this.#startPos = { x: 0, y: 0 };
    this.#state = "idle";
    this.#selectionRect = { x: 0, y: 0, width: 0, height: 0 };
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    this.#state = "dragging";
    this.#startPos = this.#editor.getMousePosition(e.clientX, e.clientY);
  }

  onMouseUp(_: React.MouseEvent<HTMLCanvasElement>): void {
    this.#state = "done";
    this.#editor.requestRedraw();
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (this.#state !== "dragging") return;

    const { x, y } = this.#editor.getMousePosition(e.clientX, e.clientY);

    const width = x - this.#startPos.x;
    const height = y - this.#startPos.y;

    this.#selectionRect = {
      x: this.#startPos.x,
      y: this.#startPos.y,
      width,
      height,
    };

    this.#editor.requestRedraw();
  }

  drawInteractive(ctx: IRenderer): void {
    if (this.#state !== "dragging") return;
    ctx.setStyle({
      ...SELECTION_RECTANGLE_STYLES,
      strokeStyle: "transparent",
    });
    ctx.fillRect(
      this.#selectionRect.x,
      this.#selectionRect.y,
      this.#selectionRect.width,
      this.#selectionRect.height,
    );

    ctx.setStyle({
      ...SELECTION_RECTANGLE_STYLES,
      fillStyle: "transparent",
    });
    ctx.strokeRect(
      this.#selectionRect.x,
      this.#selectionRect.y,
      this.#selectionRect.width,
      this.#selectionRect.height,
    );
  }
}
