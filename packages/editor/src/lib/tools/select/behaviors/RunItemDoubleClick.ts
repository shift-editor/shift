import type { ToolContext } from "../../core/Behavior";
import type { DoubleClickEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

/** Double-clicking a glyph in the page run makes it the edited glyph, in place and as one undo step. */
export class RunItemDoubleClick implements SelectBehavior {
  onDoubleClick(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: DoubleClickEvent,
  ): boolean {
    if (state.type !== "ready" || event.target.kind !== "text") return false;
    const { itemId, node: run } = event.target;

    const editor = ctx.editor;
    const sourceId = editor.activeSourceId ?? editor.font.defaultSource.id;
    const enter = () => {
      const child = editor.runChildren.editItem(run, itemId, sourceId);
      if (!child) return false;
      editor.selection.clear();
      editor.hover.clear();
      editor.editing.enter(child.id);
      return true;
    };
    return editor.history.captureOrJoin("Edit glyph", enter);
  }
}
