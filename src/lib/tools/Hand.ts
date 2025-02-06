import { Tool, ToolName } from "../../types/tool";

export class Hand implements Tool {
  public readonly name: ToolName = "hand";

  #dragging = false;

  onMouseDown(_: React.MouseEvent<HTMLCanvasElement>): void {
    this.#dragging = true;
  }

  onMouseUp(_: React.MouseEvent<HTMLCanvasElement>): void {
    this.#dragging = false;
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (!this.#dragging) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const mousePosition = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };

    console.log(mousePosition);
  }
}
