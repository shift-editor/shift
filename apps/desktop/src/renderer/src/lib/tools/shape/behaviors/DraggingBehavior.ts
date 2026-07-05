import { createBehavior, type ToolContext } from "../../core/Behavior";
import type { DragEvent } from "../../core/GestureDetector";
import type { ShapeState } from "../types";

export const ShapeDraggingBehavior = createBehavior<ShapeState>({
  onDrag(state: ShapeState, ctx: ToolContext<ShapeState>, event: DragEvent): boolean {
    if (state.type !== "dragging") return false;
    ctx.setState({ ...state, currentPos: event.coords.scene });
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
