import type { ToolContext } from "../../core/Behavior";
import type { KeyDownEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

/**
 * Steps out one level: deselects, then collapses to one source, then leaves
 * the edited glyph into the text box it sits in, then leaves that box.
 */
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
      const editor = ctx.editor;
      const box = editor.editing.nodeIds
        .map((id) => editor.scene.parent(id))
        .find((parent) => parent?.kind === "textRun");
      editor.history.capture("Exit glyph", () => editor.exitNodes());
      // The box's glyphs stay one click away, as they were while the glyph was edited.
      if (box) editor.nodeDefinition("textRun").enter(box.id);
      return true;
    }

    const runs = ctx.editor.nodeDefinition("textRun");
    if (runs.entered) {
      runs.leave();
      return true;
    }

    return false;
  }
}
