import { Tool } from "../../types/tool";
import { Editor } from "../editor/Editor";

export class Select implements Tool {
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
