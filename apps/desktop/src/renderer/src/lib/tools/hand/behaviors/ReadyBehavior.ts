import { createBehavior, type ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { HandState } from "../types";

export const HandReadyBehavior = createBehavior<HandState>({
  onDragStart(
    state: HandState,
    ctx: ToolContext<HandState>,
    event: ToolEventOf<"dragStart">,
  ): boolean {
    if (state.type !== "ready") return false;
    const startPan = ctx.editor.pan;
    ctx.setState({
      type: "dragging",
      screenStart: event.screenPoint,
      startPan,
    });
    return true;
  },
});
