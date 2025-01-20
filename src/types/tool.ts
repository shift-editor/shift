import { Editor } from "../lib/editor/Editor";

export interface Tool {
  name: string;
  editor: Editor;

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void;
  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void;
  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void;
}
