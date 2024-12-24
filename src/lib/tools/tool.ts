import { IRenderer } from "../../types/renderer";
import { Editor } from "../editor/editor";

export interface Tool {
  editor: Editor;

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void;
  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void;
  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void;

  draw(renderer: IRenderer): void;
}
