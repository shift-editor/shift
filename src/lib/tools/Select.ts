import { ContourPoint } from "@/lib/core/Contour";
import { Editor } from "@/lib/editor/Editor";
import { getBoundingRectPoints, Rect } from "@/lib/math/rect";
import {
  BOUNDING_RECTANGLE_STYLES,
  SELECTION_RECTANGLE_STYLES,
} from "@/lib/styles/style";
import { IRenderer } from "@/types/graphics";
import { Point2D } from "@/types/math";
import { Tool, ToolName } from "@/types/tool";

export type SelectState = "idle" | "dragging" | "done";
export class Select implements Tool {
  public readonly name: ToolName = "select";

  #editor: Editor;
  #startPos: Point2D;
  #state: SelectState;
  #selectedPoints: Set<ContourPoint>;

  #selectionRect: Rect;
  #boundingRect: Rect;

  public constructor(editor: Editor) {
    this.#editor = editor;
    this.#startPos = { x: 0, y: 0 };
    this.#state = "idle";
    this.#selectionRect = new Rect(0, 0, 0, 0);
    this.#boundingRect = new Rect(0, 0, 0, 0);
    this.#selectedPoints = new Set();
  }

  //  you can either be dragging:
  //  corner point
  //  bounding box
  //  handles
  //  handles on the bounding box

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    this.#state = "dragging";
    const { x: mouseX, y: mouseY } = this.#editor.getMousePosition(
      e.clientX,
      e.clientY,
    );
    const { x, y } = this.#editor.getUpmMousePosition(mouseX, mouseY);

    for (const p of this.#editor.getAllPoints()) {
      if (!this.#selectedPoints.has(p) && p.distance(x, y) < 6) {
        this.#selectedPoints.add(p);
      }
    }

    const {
      x: bbX,
      y: bbY,
      width,
      height,
    } = getBoundingRectPoints(Array.from(this.#selectedPoints));
    this.#boundingRect.reposition(bbX, bbY);
    this.#boundingRect.resize(width, height);

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

    this.#selectionRect.reposition(this.#startPos.x, this.#startPos.y);
    this.#selectionRect.resize(width, height);

    this.#editor.requestRedraw();
  }

  drawInteractive(ctx: IRenderer): void {
    switch (this.#state) {
      case "dragging":
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
        break;
      case "done":
        ctx.setStyle({
          ...BOUNDING_RECTANGLE_STYLES,
          fillStyle: "transparent",
        });
        ctx.strokeRect(
          this.#boundingRect.x,
          this.#boundingRect.y,
          this.#boundingRect.width,
          this.#boundingRect.height,
        );
        break;
    }
  }
}
