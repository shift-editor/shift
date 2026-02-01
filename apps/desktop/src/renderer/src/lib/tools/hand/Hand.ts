import { BaseTool, type ToolName, type ToolEvent, defineStateDiagram } from "../core";
import type { CursorType } from "@/types/editor";
import type { HandState, HandBehavior } from "./types";
import { HandReadyBehavior, HandDraggingBehavior } from "./behaviors";

export class Hand extends BaseTool<HandState> {
  static stateSpec = defineStateDiagram<HandState["type"]>({
    states: ["idle", "ready", "dragging"],
    initial: "idle",
    transitions: [
      { from: "idle", to: "ready", event: "activate" },
      { from: "ready", to: "dragging", event: "dragStart" },
      { from: "dragging", to: "ready", event: "dragEnd" },
      { from: "ready", to: "idle", event: "deactivate" },
    ],
  });

  readonly id: ToolName = "hand";

  private behaviors: HandBehavior[] = [HandReadyBehavior, HandDraggingBehavior];

  getCursor(state: HandState): CursorType {
    if (state.type === "dragging") return { type: "grabbing" };
    return { type: "grab" };
  }

  initialState(): HandState {
    return { type: "idle" };
  }

  transition(state: HandState, event: ToolEvent): HandState {
    if (state.type === "idle") return state;

    for (const behavior of this.behaviors) {
      if (behavior.canHandle(state, event)) {
        const result = behavior.transition(state, event, this.editor);
        if (result !== null) return result;
      }
    }

    return state;
  }

  activate(): void {
    this.state = { type: "ready" };
  }

  deactivate(): void {
    this.state = { type: "idle" };
  }
}
