import { Tool, ToolName } from "../../types/tool";

export class Pen implements Tool {
  public readonly name: ToolName = "pen";

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    console.log("pen onMouseDown");
  }

  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {
    console.log("pen onMouseUp");
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    console.log("pen onMouseMove");
  }
}
