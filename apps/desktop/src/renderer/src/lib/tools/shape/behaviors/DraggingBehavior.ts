import { createBehavior, type ToolContext } from "../../core/Behavior";
import type { DragEvent } from "../../core/GestureDetector";
import type { Shape } from "../Shape";
import type { ShapeState } from "../types";

export const ShapeDraggingBehavior = createBehavior<ShapeState, Shape>({
  onDrag(state: ShapeState, ctx: ToolContext<ShapeState>, event: DragEvent): boolean {
    if (state.type !== "dragging") return false;
    ctx.setState({ ...state, currentPos: event.coords.scene });
    return true;
  },

  onDragEnd(state: ShapeState, ctx: ToolContext<ShapeState, Shape>): boolean {
    if (state.type !== "dragging") return false;

    const contourId = ctx.tool.commitShape(state);
    if (contourId) {
      ctx.editor.selection.select([contourId]);
      ctx.editor.setActiveTool("select");
      return true;
    }

    ctx.setState({ type: "ready" });
    return true;
  },

  onDragCancel(state: ShapeState, ctx: ToolContext<ShapeState>): boolean {
    if (state.type !== "dragging") return false;
    ctx.setState({ type: "ready" });
    return true;
  },
});
