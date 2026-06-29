import type { ToolContext } from "../../core/Behavior";
import type { DoubleClickEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

export class ToggleSmooth implements SelectBehavior {
  onDoubleClick(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: DoubleClickEvent,
  ): boolean {
    void event;
    if (state.type !== "ready" && ctx.editor.selection.hasSelection()) return false;
    return false;
  }
}
