import { Tool, ToolName } from "@/types/tool";
import type { HandState } from "@/types/hand";

import { Editor } from "@/lib/editor/Editor";

export class Hand implements Tool {
  public readonly name: ToolName = "hand";

  #editor: Editor;
  #state: HandState;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#state = { type: "idle" };
  }

  setIdle(): void {
    this.#state = { type: "idle" };
  }

  setReady(): void {
    this.#state = { type: "ready" };
    this.#editor.setCursor({ type: "grab" });
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    const startPos = this.#editor.getMousePosition(e.clientX, e.clientY);
    const startPan = this.#editor.getPan();

    this.#state = { type: "dragging", startPos, startPan };
    this.#editor.setCursor({ type: "grabbing" });
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (this.#state.type !== "dragging") return;

    const { x, y } = this.#editor.getMousePosition(e.clientX, e.clientY);

    const dx = x - this.#state.startPos.x;
    const dy = y - this.#state.startPos.y;

    const panX = this.#state.startPan.x + dx;
    const panY = this.#state.startPan.y + dy;

    this.#editor.pan(panX, panY);
    this.#editor.requestRedraw();
  }

  onMouseUp(_: React.MouseEvent<HTMLCanvasElement>): void {
    this.#state = { type: "ready" };
    this.#editor.setCursor({ type: "grab" });
    this.#editor.cancelRedraw();
  }
}
