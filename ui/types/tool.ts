import { IRenderer } from "./graphics";

export type ToolName = "select" | "pen" | "hand" | "shape";
export interface Tool {
  name: ToolName;

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void;
  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void;
  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void;

  keyDownHandler?(e: KeyboardEvent): void;
  keyUpHandler?(e: KeyboardEvent): void;

  drawInteractive?(ctx: IRenderer): void;
}
