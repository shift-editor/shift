import { Editor } from "@/lib/editor/Editor";
import { DEFAULT_STYLES } from "@/lib/styles/style";
import { IRenderer } from "@/types/graphics";
import { Point2D, Rect2D } from "@/types/math";
import { Tool, ToolName, ToolState } from "@/types/tool";

export class Shape implements Tool {
  public readonly name: ToolName = "shape";
  #editor: Editor;
  #startPos: Point2D;
  #state: ToolState;
  #rect: Rect2D;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#startPos = { x: 0, y: 0 };
    this.#state = "idle";
    this.#rect = { x: 0, y: 0, width: 0, height: 0 };
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    this.#state = "dragging";
    this.#startPos = this.#editor.getMousePosition(e.clientX, e.clientY);
  }

  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {
    this.#state = "done";
    this.#editor.requestRedraw();
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (this.#state !== "dragging") return;

    const { x, y } = this.#editor.getMousePosition(e.clientX, e.clientY);

    const width = x - this.#startPos.x;
    const height = y - this.#startPos.y;

    this.#rect = {
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
      ...DEFAULT_STYLES,
      fillStyle: "transparent",
    });

    ctx.strokeRect(
      this.#rect.x,
      this.#rect.y,
      this.#rect.width,
      this.#rect.height,
    );
  }
}
