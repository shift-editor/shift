import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

export class Escape implements SelectBehavior {
  onKeyDown(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"keyDown">,
  ): boolean {
    if (event.key !== "Escape") return false;

    if (state.type === "selected") {
      ctx.editor.selection.clear();
      ctx.setState({ type: "ready" });
      return true;
    }

    return state.type === "ready";
  }
}
