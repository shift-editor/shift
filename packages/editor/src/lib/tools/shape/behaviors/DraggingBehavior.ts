import { createBehavior, type ToolContext } from "../../core/Behavior";
import type { DragEvent } from "../../core/GestureDetector";
import type { ShapeTool } from "../ShapeTool";
import type { ShapeState } from "../types";

export const ShapeDraggingBehavior = createBehavior<ShapeState, ShapeTool>({
  onDrag(state: ShapeState, ctx: ToolContext<ShapeState, ShapeTool>, event: DragEvent): boolean {
    if (state.type !== "dragging") return false;
    const next: ShapeState = { ...state, currentPos: event.coords.scene };
    ctx.tool.previewShape(next);
    ctx.setState(next);
    return true;
  },

  onKeyDown(state, ctx, event): boolean {
    if (state.type !== "dragging" || event.key !== "Shift") return false;
    ctx.tool.previewShape(state);
    return true;
  },

  onKeyUp(state, ctx, event): boolean {
    if (state.type !== "dragging" || event.key !== "Shift") return false;
    ctx.tool.previewShape(state);
    return true;
  },

  onDragEnd(state: ShapeState, ctx: ToolContext<ShapeState, ShapeTool>): boolean {
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
