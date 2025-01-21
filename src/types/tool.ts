import { Editor } from "../lib/editor/editor";

export type ToolName = "select" | "pen";
export interface Tool {
  name: ToolName;
  editor: Editor;

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void;
  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void;
  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void;
}
