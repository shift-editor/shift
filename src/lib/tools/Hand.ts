import AppState from "@/store/store";

import { Tool, ToolName } from "../../types/tool";

export class Hand implements Tool {
  public readonly name: ToolName = "hand";

  #dragging = false;
  #startPos = { x: 0, y: 0 };
  #offset = { x: 0, y: 0 };

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    this.#startPos = {
      x: e.clientX - this.#offset.x,
      y: e.clientY - this.#offset.y,
    };
    this.#dragging = true;
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (!this.#dragging) return;
    const editor = AppState.getState().editor;

    this.#offset = {
      x: e.clientX - this.#startPos.x,
      y: e.clientY - this.#startPos.y,
    };

    editor.pan(this.#offset.x, this.#offset.y);
    editor.requestRedraw();
  }

  onMouseUp(_: React.MouseEvent<HTMLCanvasElement>): void {
    this.#dragging = false;
  }
}
