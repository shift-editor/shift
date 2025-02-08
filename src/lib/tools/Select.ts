import { Tool, ToolName } from "../../types/tool";

export class Select implements Tool {
  public readonly name: ToolName = "select";

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {}

  onMouseUp(_: React.MouseEvent<HTMLCanvasElement>): void {
    console.log("select onMouseUp");
  }

  onMouseMove(_: React.MouseEvent<HTMLCanvasElement>): void {
    console.log("select onMouseMove");
  }
}
