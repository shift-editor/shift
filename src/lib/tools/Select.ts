import { IRenderer } from "@/types/graphics";
import { Point2D, Rect2D } from "@/types/math";

import { Tool, ToolName } from "../../types/tool";
import { ContourPoint } from "../core/Contour";
import { Editor } from "../editor/Editor";
import { SELECTION_RECTANGLE_STYLES } from "../styles/style";

export type SelectState = "idle" | "dragging" | "done";
export class Select implements Tool {
  public readonly name: ToolName = "select";

  #editor: Editor;
  #startPos: Point2D;
  #state: SelectState;
  #selectionRect: Rect2D;
  #selectedPoints: ContourPoint[];

  public constructor(editor: Editor) {
    this.#editor = editor;
    this.#startPos = { x: 0, y: 0 };
    this.#state = "idle";
    this.#selectionRect = { x: 0, y: 0, width: 0, height: 0 };
    this.#selectedPoints = [];
  }

  isDraggingSelectedPoint(x: number, y: number): boolean {
    for (const p of this.#selectedPoints) {
      return p.distance(x, y) < 6;
    }

    return false;
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    this.#state = "dragging";
    const { x, y } = this.#editor.getUpmMousePosition(e.clientX, e.clientY);
    for (const p of this.#editor.getAllPoints()) {
      if (p.distance(x, y) < 6) {
        this.#selectedPoints.push(p);
      }
    }

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
