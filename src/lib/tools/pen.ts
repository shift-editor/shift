import { Editor } from "@/lib/editor/Editor";
import { Tool, ToolName } from "@/types/tool";

export class Pen implements Tool {
  public readonly name: ToolName = "pen";

  #editor: Editor;

  public constructor(editor: Editor) {
    this.#editor = editor;
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    this.#editor.addPoint(e.clientX, e.clientY);
    this.#editor.requestRedraw();
  }

  onMouseUp(_: React.MouseEvent<HTMLCanvasElement>): void {}

  onMouseMove(_: React.MouseEvent<HTMLCanvasElement>): void {}
}
