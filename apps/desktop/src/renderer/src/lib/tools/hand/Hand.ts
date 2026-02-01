import type { Point2D } from "@shift/types";
import { BaseTool, type ToolName, type ToolEvent, defineStateDiagram } from "../core";
import { computed, type ComputedSignal } from "@/lib/reactive/signal";
import type { CursorType } from "@/types/editor";
import type { Editor } from "@/lib/editor";

type HandState =
  | { type: "idle" }
  | { type: "ready" }
  | { type: "dragging"; screenStart: Point2D; startPan: Point2D };

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
  readonly $cursor: ComputedSignal<CursorType>;

  constructor(editor: Editor) {
    super(editor);

    this.$cursor = computed<CursorType>(() => {
      const state = this.editor.activeToolState.value as HandState;
      if (state.type === "dragging") return { type: "grabbing" };
      return { type: "grab" };
    });
  }

  initialState(): HandState {
    return { type: "idle" };
  }

  transition(state: HandState, event: ToolEvent): HandState {
    switch (state.type) {
      case "idle":
        return state;

      case "ready":
        if (event.type === "dragStart") {
          const startPan = this.editor.pan;
          return {
            type: "dragging",
            screenStart: event.screenPoint,
            startPan,
          };
        }
        return state;

      case "dragging":
        if (event.type === "drag") {
          const screenDelta = event.screenDelta;
          const newPan = {
            x: state.startPan.x + screenDelta.x,
            y: state.startPan.y + screenDelta.y,
          };
          this.editor.setPan(newPan.x, newPan.y);
          this.editor.render.requestRedraw();
          return state;
        }
        if (event.type === "dragEnd" || event.type === "dragCancel") {
          return { type: "ready" };
        }
        return state;

      default:
        return state;
    }
  }

  activate(): void {
    this.state = { type: "ready" };
  }

  deactivate(): void {
    this.state = { type: "idle" };
  }
}
