import { Editor } from "@/lib/editor/Editor";
import { Tool, ToolName, ToolState } from "@/types/tool";

export class Pen implements Tool {
  public readonly name: ToolName = "pen";

  #editor: Editor;
  #toolState: ToolState;

  public constructor(editor: Editor) {
    this.#editor = editor;
    this.#toolState = "idle";
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    this.#toolState = "dragging";
    const id = this.#editor.addPoint(e.clientX, e.clientY);
    this.#editor.emit("point:added", { pointId: id });
  }

  onMouseUp(_: React.MouseEvent<HTMLCanvasElement>): void {
    this.#toolState = "done";
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (this.#toolState !== "dragging") return;
  }
}
