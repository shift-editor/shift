import { createBehavior, type ToolContext } from "../../core/Behavior";
import type { DragStartEvent } from "../../core/GestureDetector";
import type { ShapeState } from "../types";

export const ShapeReadyBehavior = createBehavior<ShapeState>({
  onDragStart(state: ShapeState, ctx: ToolContext<ShapeState>, event: DragStartEvent): boolean {
    if (state.type !== "ready") return false;

    ctx.setState({
      type: "dragging",
      startPos: event.coords.scene,
      currentPos: event.coords.scene,
    });

    return true;
  },
});
