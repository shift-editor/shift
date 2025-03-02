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

import { Point } from "../math/point";

export type SelectState = "idle" | "dragging" | "done";
export class Select implements Tool {
  public readonly name: ToolName = "select";

  #editor: Editor;
  #startPos: Point2D;
  #state: SelectState;

  #selectionRect: Rect;
  #boundingRect: Rect;

  public constructor(editor: Editor) {
    this.#editor = editor;
    this.#startPos = { x: 0, y: 0 };
    this.#state = "idle";
    this.#selectionRect = new Rect(0, 0, 0, 0);
    this.#boundingRect = new Rect(0, 0, 0, 0);
  }

  processHitPoints(hitTest: (p: ContourPoint) => boolean): void {
    const hitPoints = this.#editor.getAllPoints().filter(hitTest);

    hitPoints.length !== 0
      ? hitPoints.map((p) => this.#editor.addToSelectedPoints(p))
      : this.#editor.clearSelectedPoints();
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    this.#state = "dragging";
    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);
    this.#startPos = { x, y };

    this.processHitPoints((p) => p.distance(x, y) < 3);

    const {
      x: bbX,
      y: bbY,
      width,
      height,
    } = getBoundingRectPoints(Array.from(this.#editor.selectedPoints));

    this.#boundingRect.reposition(bbX, bbY);
    this.#boundingRect.resize(width, height);
  }

  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {
    this.#state = "done";

    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);

    if (!(Point.distance(this.#startPos.x, x, this.#startPos.y, y) < 3)) {
      this.processHitPoints((p) => this.#selectionRect.hit(p.x, p.y));
      this.#selectionRect.clear();
    }

    this.#editor.requestRedraw();
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (this.#state !== "dragging") return;
    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);

    const startX = this.#startPos.x;
    const startY = this.#startPos.y;

    const normalizedX = Math.min(startX, x);
    const normalizedY = Math.min(startY, y);
    const normalizedWidth = Math.abs(x - startX);
    const normalizedHeight = Math.abs(y - startY);

    this.#selectionRect.reposition(normalizedX, normalizedY);
    this.#selectionRect.resize(normalizedWidth, normalizedHeight);

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
