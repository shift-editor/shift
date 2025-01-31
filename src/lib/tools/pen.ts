import AppState from "../../store/store";
import { Tool, ToolName } from "../../types/tool";

export class Pen implements Tool {
  public readonly name: ToolName = "pen";

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {}

  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {
    const manager = AppState.getState().scene.getPathManager();
    manager.addPath();
    console.log("added path");
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    console.log("pen onMouseMove");
  }
}
