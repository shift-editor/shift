import { BaseTool } from "../types/base";
import { Line } from "../types/shapes";

export class LineTool extends BaseTool {
  static name = "line";
  static icon = "line";

  private currentLine: Line | null = null;
  private isDrawing = false;

  render(): void {}

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    this.isDrawing = true;
    this.currentLine = new Line();
    this.currentLine.start = { x: e.clientX, y: e.clientY };
    this.currentLine.end = { x: e.clientX, y: e.clientY };
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (this.isDrawing && this.currentLine) {
      this.currentLine.end = { x: e.clientX, y: e.clientY };
    }
  }

  onMouseUp(): void {
    this.isDrawing = false;
  }
}
