import { Tool, ToolName } from "../../types/tool";

export class Hand implements Tool {
  public readonly name: ToolName = "hand";

  onMouseDown(_: React.MouseEvent<HTMLCanvasElement>): void {}

  onMouseUp(_: React.MouseEvent<HTMLCanvasElement>): void {}

  onMouseMove(_: React.MouseEvent<HTMLCanvasElement>): void {}
}
