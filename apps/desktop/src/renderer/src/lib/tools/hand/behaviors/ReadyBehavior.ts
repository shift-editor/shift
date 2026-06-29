import { createBehavior, type ToolContext } from "../../core/Behavior";
import type { DragStartEvent } from "../../core/GestureDetector";
import type { HandState } from "../types";

export const HandReadyBehavior = createBehavior<HandState>({
  onDragStart(state: HandState, ctx: ToolContext<HandState>, event: DragStartEvent): boolean {
    if (state.type !== "ready") return false;
    const startPan = ctx.editor.pan;
    ctx.setState({
      type: "dragging",
      screenStart: event.coords.screen,
      startPan,
    });
    return true;
  },
});
