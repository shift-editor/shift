import { Editor } from "../editor/Editor";
import { Tool } from "./Tool";

export class Pen implements Tool {
  public constructor(public editor: Editor) {}

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    const p = this.editor.canvasManager.getRelativePosition(e);
    this.editor.pathManager.addPoint(p);
    this.editor.draw();
  }

  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {}

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    const p = this.editor.canvasManager.getRelativePosition(e);
  }
}
