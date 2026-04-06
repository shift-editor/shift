import { createBehavior, type ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { ShapeState } from "../types";

export const ShapeDraggingBehavior = createBehavior<ShapeState>({
  onDrag(state: ShapeState, ctx: ToolContext<ShapeState>, event: ToolEventOf<"drag">): boolean {
    if (state.type !== "dragging") return false;
    ctx.setState({ ...state, currentPos: event.point });
    return true;
  },

  onDragEnd(state: ShapeState, ctx: ToolContext<ShapeState>): boolean {
    if (state.type !== "dragging") return false;
    ctx.setState({ type: "ready" });
    return true;
  },

  onDragCancel(state: ShapeState, ctx: ToolContext<ShapeState>): boolean {
    if (state.type !== "dragging") return false;
    ctx.setState({ type: "ready" });
    return true;
  },
});
