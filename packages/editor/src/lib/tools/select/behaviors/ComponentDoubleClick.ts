import { editRunItem } from "../../../text/runChildren";
import type { ToolContext } from "../../core/Behavior";
import type { DoubleClickEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

/**
 * Double-clicking a component opens its base glyph next to the edited glyph.
 *
 * @remarks
 * Inserts the base glyph into the run right after the edited glyph's item and
 * edits it, as one undo step. A drawn component's base is always loaded:
 * `Font.loadGlyphs` loads component bases with the glyph that uses them.
 */
export class ComponentDoubleClick implements SelectBehavior {
  onDoubleClick(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: DoubleClickEvent,
  ): boolean {
    if (state.type !== "ready" || event.target.kind !== "component") return false;

    const editor = ctx.editor;
    const edited = editor.scene.nodeOfKind(event.target.nodeId, "glyph");
    const run = editor.scene.nodeOfKind(edited?.parentId ?? null, "textRun");
    const component = editor.object(event.target.componentId);
    if (!edited?.itemId || !run || component?.kind !== "component") return false;

    const afterId = edited.itemId;
    const base = editor.text.glyphItem(component.component.glyphId);
    if (!base) return false;

    return editor.history.captureOrJoin("Open component base", () => {
      if (!editor.text.insertAfter(run.runId, afterId, [base])) return false;
      const child = editRunItem(editor, run, base.id, edited.sourceId);
      if (!child) return false;
      editor.selection.clear();
      editor.editing.enter(child.id);
      return true;
    });
  }
}
