import { createBehavior, type ToolContext } from "../../core/Behavior";
import type { DragEvent } from "../../core/GestureDetector";
import type { HandState } from "../types";
import { Vec2 } from "@shift/geo";

export const HandDraggingBehavior = createBehavior<HandState>({
  onDrag(state: HandState, ctx: ToolContext<HandState>, event: DragEvent): boolean {
    if (state.type !== "dragging") return false;
    const newPan = Vec2.add(state.startPan, event.delta.screen);
    ctx.editor.setPan(newPan);
    return true;
  },

  onDragEnd(state: HandState, ctx: ToolContext<HandState>): boolean {
    if (state.type !== "dragging") return false;
    ctx.setState({ type: "ready" });
    return true;
  },

  onDragCancel(state: HandState, ctx: ToolContext<HandState>): boolean {
    if (state.type !== "dragging") return false;
    ctx.setState({ type: "ready" });
    return true;
  },
});
