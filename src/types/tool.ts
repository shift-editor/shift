import { IRenderer } from "./graphics";

export type ToolName = "select" | "pen" | "hand" | "shape";
export type ToolState = "idle" | "dragging" | "done";
export interface Tool {
  name: ToolName;

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void;
  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void;
  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void;

  drawInteractive?(ctx: IRenderer): void;
}
