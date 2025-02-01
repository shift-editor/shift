import { Tool, ToolName } from "../../types/tool";

export class Hand implements Tool {
  public readonly name: ToolName = "hand";

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {}

  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {}

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {}
}
