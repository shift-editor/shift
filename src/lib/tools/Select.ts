import { Tool, ToolName } from "../../types/tool";

export class Select implements Tool {
  public readonly name: ToolName = "select";

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    const { x, y } = e.currentTarget.getBoundingClientRect();

    console.log("select onMouseDown ", e.clientX - x, e.clientY - y);
  }

  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {
    console.log("select onMouseUp");
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    console.log("select onMouseMove");
  }
}
