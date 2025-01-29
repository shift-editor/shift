import AppState from "../../store/store";
import { Tool, ToolName } from "../../types/tool";
import { Point } from "../geometry/point";

export class Pen implements Tool {
  public readonly name: ToolName = "pen";

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    const pathManager = AppState.getState().pathManager;
    pathManager.addPoint(new Point(e.clientX, e.clientY));
    console.log("added point");

    console.log(pathManager.paths[0].points);
  }

  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {
    const pathManager = AppState.getState().pathManager;
    pathManager.addPath();
    console.log("added path");
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    console.log("pen onMouseMove");
  }
}
