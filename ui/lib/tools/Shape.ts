import { Editor } from "@/lib/editor/Editor";
import { DEFAULT_STYLES } from "@/lib/styles/style";
import { IRenderer } from "@/types/graphics";
import { Point2D, Rect2D } from "@/types/math";
import { Tool, ToolName } from "@/types/tool";

type ShapeState = "idle" | "dragging";
export class Shape implements Tool {
  public readonly name: ToolName = "shape";
  #editor: Editor;
  #startPos: Point2D;
  #state: ShapeState;
  #rect: Rect2D;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#startPos = { x: 0, y: 0 };
    this.#state = "idle";
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

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    this.#state = "dragging";
    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);

    this.#startPos = { x, y };
  }

  onMouseUp(_: React.MouseEvent<HTMLCanvasElement>): void {
    this.#state = "idle";

    const id = this.#editor.addPoint(this.#rect.x, this.#rect.y);
    this.#editor.addPoint(this.#rect.x + this.#rect.width, this.#rect.y);
    this.#editor.addPoint(
      this.#rect.x + this.#rect.width,
      this.#rect.y + this.#rect.height,
    );
    this.#editor.addPoint(this.#rect.x, this.#rect.y + this.#rect.height);
    this.#editor.closeContour();

    this.#editor.emit("points:added", [id]);
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (this.#state !== "dragging") return;

    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);

    const width = x - this.#startPos.x;
    const height = y - this.#startPos.y;

    this.#rect = {
      x: this.#startPos.x,
      y: this.#startPos.y,
      width,
      height,
      left: this.#startPos.x,
      top: this.#startPos.y,
      right: this.#startPos.x + width,
      bottom: this.#startPos.y + height,
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
