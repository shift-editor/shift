import AppState from "@/store/store";

import { Tool, ToolName } from "../../types/tool";
import { getMouseCoords } from "../utils/utils";

export class Hand implements Tool {
  public readonly name: ToolName = "hand";

  #dragging = false;
  #startPos = { x: 0, y: 0 };
  #startPan = { x: 0, y: 0 };

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    this.#startPos = getMouseCoords(
      e.clientX,
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
    );

    this.#startPan = AppState.getState().editor.getPan();

    this.#dragging = true;
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (!this.#dragging) return;
    const { x, y } = getMouseCoords(
      e.clientX,
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
    );

    const dx = x - this.#startPos.x;
    const dy = y - this.#startPos.y;

    const editor = AppState.getState().editor;

    const panX = this.#startPan.x + dx;
    const panY = this.#startPan.y + dy;
    editor.pan(panX, panY);

    editor.requestRedraw();
  }

  onMouseUp(_: React.MouseEvent<HTMLCanvasElement>): void {
    this.#dragging = false;
  }
}
