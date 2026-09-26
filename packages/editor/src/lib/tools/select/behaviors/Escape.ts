import type { ToolContext } from "../../core/Behavior";
import type { KeyDownEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

export class Escape implements SelectBehavior {
  onKeyDown(_state: SelectState, ctx: ToolContext<SelectState>, event: KeyDownEvent): boolean {
    if (event.key !== "Escape") return false;

    if (ctx.editor.selection.hasSelection()) {
      const capture = ctx.editor.history.begin("Deselect");
      try {
        ctx.editor.selection.clear();
        ctx.setState({ type: "ready" });
        capture.finish();
      } catch (error) {
        capture.cancel();
        throw error;
      }
      return true;
    }

    return false;
  }
}
