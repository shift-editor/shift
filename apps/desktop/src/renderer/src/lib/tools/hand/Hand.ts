import { BaseTool, type ToolName } from "../core";
import type { CursorType } from "@/types/editor";
import type { HandState } from "./types";
import { HandReadyBehavior, HandDraggingBehavior } from "./behaviors";
import { NodeId } from "@shift/types";

export class Hand extends BaseTool<HandState> {
  readonly id: ToolName = "hand";

  #stashedEditingNodes: NodeId[] = [];

  readonly behaviors = [HandReadyBehavior, HandDraggingBehavior];

  override getCursor(state: HandState): CursorType {
    if (state.type === "dragging") return { type: "grabbing" };
    return { type: "grab" };
  }

  initialState(): HandState {
    return { type: "idle" };
  }

  override activate(): void {
    this.#stashedEditingNodes = [...this.editor.editing.nodeIds];
    this.editor.editing.clear();

    this.state = { type: "ready" };
  }

  override deactivate(): void {
    this.editor.editing.set(this.#stashedEditingNodes);
    this.#stashedEditingNodes = [];

    this.state = { type: "idle" };
  }
}
