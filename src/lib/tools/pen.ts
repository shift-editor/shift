import { Editor } from "@/lib/editor/Editor";
import { IRenderer } from "@/types/graphics";
import { Point2D } from "@/types/math";
import { Tool, ToolName, ToolState } from "@/types/tool";

import { EntityId, Ident } from "../core/EntityId";
import { Point } from "../math/point";

export class Pen implements Tool {
  public readonly name: ToolName = "pen";

  #editor: Editor;
  #toolState: ToolState;

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
    this.#firstPoint = new Point(position.x, position.y);

    const id = this.#editor.addPoint(e.clientX, e.clientY);
    this.#addedPoint = id.id;
    this.#editor.emit("point:added", { pointId: id });
  }

  onMouseUp(_: React.MouseEvent<HTMLCanvasElement>): void {
    this.#toolState = "done";
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (this.#toolState !== "dragging") return;
    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const distance = this.#firstPoint.distance(
      new Point(position.x, position.y),
    );

    if (distance > 10 && this.#addedPoint) {
      console.log("distance", distance);
      console.log("addedPoint", this.#addedPoint);
      this.#editor.upgradeLineSegment(this.#addedPoint);
      this.#addedPoint = null;
    }
    this.#editor.requestRedraw();
  }

  drawInteractive(ctx: IRenderer): void {}
}
