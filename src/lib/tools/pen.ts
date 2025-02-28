import { Editor } from "@/lib/editor/Editor";
import { IRenderer } from "@/types/graphics";
import { Tool, ToolName } from "@/types/tool";

import { Ident } from "../core/EntityId";
import { Point } from "../math/point";

export type PenState = "idle" | "dragging" | "draggingHandle" | "done";
export class Pen implements Tool {
  public readonly name: ToolName = "pen";

  #editor: Editor;
  #toolState: PenState;

  #firstPoint: Point;
  #addedPoint: Ident | null = null;

  public constructor(editor: Editor) {
    this.#editor = editor;
    this.#toolState = "idle";
    this.#firstPoint = new Point(0, 0);
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    this.#toolState = "dragging";

    const position = this.#editor.getMousePosition(e.clientX, e.clientY);

    const id = this.#editor.addPoint(position.x, position.y);
    this.#addedPoint = id.id;
    this.#editor.emit("point:added", { pointId: id });
  }

  onMouseUp(_: React.MouseEvent<HTMLCanvasElement>): void {
    // TODO: properly commit the handle point here with a point moved event
    this.#toolState = "done";
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (this.#toolState !== "dragging") return;
    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const distance = this.#firstPoint.distance(position.x, position.y);

    if (distance > 10 && this.#addedPoint) {
      this.#editor.upgradeLineSegment(this.#addedPoint);
      this.#toolState = "draggingHandle";
    }

    // TODO: we can move the point around here but not actually send a move point event
    // that way we can re-draw the contour but then send an event to "commit" the final point
    // which I anticipate will be useful for undo/redo
    this.#editor.requestRedraw();
  }

  drawInteractive(ctx: IRenderer): void {
    // TODO: draw the trailing handle
    if (this.#toolState !== "draggingHandle") return;
  }
}
