import { Editor } from "../editor/editor";
import { Tool } from "./tool";

export class Pen implements Tool {
  public constructor(public editor: Editor) {}

  draw(): void {}
  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    this.editor.paths;
  }
  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {}

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    const p = this.editor.canvasManager.getRelativePosition(e);

    console.log(p.x, p.y);
  }
}
