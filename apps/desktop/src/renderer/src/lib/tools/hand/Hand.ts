import { BaseTool, type ToolName, defineStateDiagram } from "../core";
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

  readonly behaviors: HandBehavior[] = [HandReadyBehavior, HandDraggingBehavior];

  getCursor(state: HandState): CursorType {
    if (state.type === "dragging") return { type: "grabbing" };
    return { type: "grab" };
  }

  initialState(): HandState {
    return { type: "idle" };
  }

  activate(): void {
    this.state = { type: "ready" };
  }

  deactivate(): void {
    this.state = { type: "idle" };
  }
}
