import type { Point2D } from "@shift/types";
import { BaseTool, type ToolName, type ToolEvent } from "../core";

type HandState =
  | { type: "idle" }
  | { type: "ready" }
  | { type: "dragging"; screenStart: Point2D; startPan: Point2D };

export class Hand extends BaseTool<HandState> {
  readonly id: ToolName = "hand";

  initialState(): HandState {
    return { type: "idle" };
  }

  transition(state: HandState, event: ToolEvent): HandState {
    switch (state.type) {
      case "idle":
        return state;

      case "ready":
        if (event.type === "dragStart") {
          const startPan = this.ctx.viewport.getPan();
          this.ctx.cursor.set({ type: "grabbing" });
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
          const pan = {
            x: state.startPan.x + screenDelta.x,
            y: state.startPan.y + screenDelta.y,
          };
          this.ctx.viewport.pan(pan.x, pan.y);
          this.ctx.render.requestRedraw();
          return state;
        }
        if (event.type === "dragEnd" || event.type === "dragCancel") {
          this.ctx.cursor.set({ type: "grab" });
          return { type: "ready" };
        }
        return state;

      default:
        return state;
    }
  }

  activate(): void {
    this.state = { type: "ready" };
    this.ctx.cursor.set({ type: "grab" });
  }

  deactivate(): void {
    this.state = { type: "idle" };
  }
}
