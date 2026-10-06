import { BaseTool, type ToolName } from "../core";
import type { CursorType } from "../../../types/editor";
import type { HandState } from "./types";
import { HandReadyBehavior, HandDraggingBehavior } from "./behaviors";

export class Hand extends BaseTool<HandState> {
  readonly id: ToolName = "hand";

  #restoreEditing: (() => void) | null = null;

  readonly behaviors = [HandReadyBehavior, HandDraggingBehavior];

  override getCursor(): CursorType {
    if (this.editor.input.pointerDownCell.value) return { type: "grabbing" };
    return { type: "grab" };
  }

  initialState(): HandState {
    return { type: "idle" };
  }

  override activate(): void {
    this.#restoreEditing = this.editor.editing.suspend();

    this.setState({ type: "ready" });
  }

  override deactivate(): void {
    if (this.#restoreEditing) this.#restoreEditing();
    this.#restoreEditing = null;

    this.setState({ type: "idle" });
  }
}
