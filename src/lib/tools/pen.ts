import { HandleType } from "../../types/handle";
import { Editor } from "../editor/editor";
import { Handle } from "../editor/handle";
import { Point } from "../geometry/point";
import { Tool } from "./tool";

export class Pen implements Tool {
  public constructor(public editor: Editor) {}

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    const p = this.editor.canvasManager.getRelativePosition(e);
    const handle = new Handle(new Point(p.x, p.y), HandleType.CORNER);
    this.editor.handles.push(handle);
  }

  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {}

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    const p = this.editor.canvasManager.getRelativePosition(e);
    for (const h of this.editor.handles) {
      if (h.hit(p)) {
        h.selected = true;
      } else {
        h.selected = false;
      }
    }
  }
}
