import type { ToolContext } from "../../core/Behavior";
import type { DoubleClickEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import type { Select, BoundingRectEdge } from "../Select";
import type { SizeAxis } from "../../../../types/transformTarget";

/**
 * Double-clicking a resize handle sizes the selection to its content along the handle's axes.
 *
 * @remarks
 * Only for targets that implement `TransformTarget.fitToContent` (text boxes);
 * otherwise the double-click falls through to the other behaviors.
 */
export class FitToContent implements SelectBehavior {
  onDoubleClick(
    state: SelectState,
    ctx: ToolContext<SelectState, Select>,
    event: DoubleClickEvent,
  ): boolean {
    if (state.type !== "ready") return false;

    const hit = ctx.tool.boundingBox.hit(event.coords);
    const target = hit?.type === "resize" ? ctx.editor.transformTarget() : null;
    if (hit?.type !== "resize" || !target?.fitToContent) return false;

    target.fitToContent(edgeAxes(hit.edge));
    return true;
  }
}

/** The sizes a resize handle changes: one for an edge, both for a corner. */
function edgeAxes(edge: Exclude<BoundingRectEdge, null>): readonly SizeAxis[] {
  switch (edge) {
    case "left":
    case "right":
      return ["width"];
    case "top":
    case "bottom":
      return ["height"];
    case "top-left":
    case "top-right":
    case "bottom-left":
    case "bottom-right":
      return ["width", "height"];
  }
}
