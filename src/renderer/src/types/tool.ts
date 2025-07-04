import { IRenderer } from './graphics';

export type ToolName = 'select' | 'pen' | 'hand' | 'shape' | 'disabled';
export interface Tool {
  name: ToolName;

  setIdle(): void;
  setReady(): void;

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void;
  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void;
  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void;

  keyDownHandler?(e: KeyboardEvent): void;
  keyUpHandler?(e: KeyboardEvent): void;
  onDoubleClick?(e: React.MouseEvent<HTMLCanvasElement>): void;

  drawInteractive?(ctx: IRenderer): void;
}
