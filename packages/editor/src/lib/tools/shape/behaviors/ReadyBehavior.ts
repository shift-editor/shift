import { createBehavior, type ToolContext } from "../../core/Behavior";
import type { DragStartEvent } from "../../core/GestureDetector";
import type { ShapeState } from "../types";
import type { ShapeTool } from "../ShapeTool";

export const ShapeReadyBehavior = createBehavior<ShapeState, ShapeTool>({
  onDragStart(
    state: ShapeState,
    ctx: ToolContext<ShapeState, ShapeTool>,
    event: DragStartEvent,
  ): boolean {
    if (state.type !== "ready") return false;

    const next: ShapeState = {
      type: "dragging",
      startPos: event.coords.scene,
      currentPos: event.coords.scene,
    };
    if (!ctx.tool.beginShape(next, ctx)) return false;

    ctx.setState(next);

    return true;
  },
});
