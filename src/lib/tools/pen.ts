import { Tool, ToolName } from "../../types/tool";

export class Pen implements Tool {
  public readonly name: ToolName = "pen";

  onMouseDown(_: React.MouseEvent<HTMLCanvasElement>): void {}

  onMouseUp(_: React.MouseEvent<HTMLCanvasElement>): void {}

  onMouseMove(_: React.MouseEvent<HTMLCanvasElement>): void {}
}
