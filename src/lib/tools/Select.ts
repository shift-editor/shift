import { Tool, ToolName } from "../../types/tool";
import { Editor } from "../editor/editor";

export class Select implements Tool {
  public readonly name: ToolName = "select";

  public constructor(public editor: Editor) {}

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    const p = this.editor.canvasManager.getRelativePosition(e);
  }

  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {
    const p = this.editor.canvasManager.getRelativePosition(e);
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    const p = this.editor.canvasManager.getRelativePosition(e);
  }
}
