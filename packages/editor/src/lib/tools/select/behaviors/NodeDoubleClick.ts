import type { ToolContext } from "../../core/Behavior";
import type { DoubleClickEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

/** Offers a double-click to the hit node's definition and its ancestors' (`NodeDefinition.onDoubleClick`). */
export class NodeDoubleClick implements SelectBehavior {
  onDoubleClick(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: DoubleClickEvent,
  ): boolean {
    if (state.type !== "ready") return false;
    return ctx.editor.doubleClickNode(event.target);
  }
}
