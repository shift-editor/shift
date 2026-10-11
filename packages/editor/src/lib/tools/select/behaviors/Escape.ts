import type { ToolContext } from "../../core/Behavior";
import type { KeyDownEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

/** Steps out one level: deselects, then collapses to one source, then leaves the edited glyph. */
export class Escape implements SelectBehavior {
  onKeyDown(_state: SelectState, ctx: ToolContext<SelectState>, event: KeyDownEvent): boolean {
    if (event.key !== "Escape") return false;

    if (ctx.editor.selection.hasSelection()) {
      ctx.editor.history.capture("Deselect", () => {
        ctx.editor.selection.clear();
        ctx.setState({ type: "ready" });
      });
      return true;
    }

    if (ctx.editor.collapseEditingSources()) return true;

    if (ctx.editor.editing.hasScope()) {
      ctx.editor.history.capture("Exit glyph", () => ctx.editor.exitNodes());
      return true;
    }

    return false;
  }
}
