import { Editor } from "@/lib/editor/Editor";
import { Tool, ToolName } from "@/types/tool";

export class Shape implements Tool {
  public readonly name: ToolName = "shape";
  #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {}

  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {}

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {}
}
