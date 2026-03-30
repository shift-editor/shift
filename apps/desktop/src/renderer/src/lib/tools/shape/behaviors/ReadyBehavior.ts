import { createBehavior, type ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { ShapeState } from "../types";

export const ShapeReadyBehavior = createBehavior<ShapeState>({
  onDragStart(
    state: ShapeState,
    ctx: ToolContext<ShapeState>,
    event: ToolEventOf<"dragStart">,
  ): boolean {
    if (state.type !== "ready") return false;

    ctx.setState({
      type: "dragging",
      startPos: event.point,
      currentPos: event.point,
    });

    return true;
  },
});
