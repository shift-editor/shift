import { Tool } from "../../types/Tool";
import { Editor } from "../editor/Editor";

export class Pen implements Tool {
  #isMousedDown: boolean = false;

  public constructor(public editor: Editor) {}

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    const p = this.editor.canvasManager.getRelativePosition(e);
    this.#isMousedDown = true;
  }

  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {
    this.#isMousedDown = false;
    const p = this.editor.canvasManager.getRelativePosition(e);

    this.editor.pathManager.addPoint(p);
    this.editor.draw();
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    // const p = this.editor.canvasManager.getRelativePosition(e);
    // if (this.#isMousedDown === true) {
    //   this.editor.pathManager.currentPath.points.pop();
    //   this.editor.pathManager.addPoint(p);
    //   this.editor.draw();
    // }
  }
}
