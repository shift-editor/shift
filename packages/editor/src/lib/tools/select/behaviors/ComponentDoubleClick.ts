import { glyphTextItem } from "../../../text/layout";
import type { ToolContext } from "../../core/Behavior";
import type { DoubleClickEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

/**
 * Double-clicking a component opens its base glyph next to the edited glyph.
 *
 * @remarks
 * Inserts the base glyph into the page run right after the edited glyph's item
 * and edits it, as one undo step. Loads the base glyph first when needed.
 */
export class ComponentDoubleClick implements SelectBehavior {
  onDoubleClick(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: DoubleClickEvent,
  ): boolean {
    if (state.type !== "ready" || event.target.kind !== "component") return false;

    const editor = ctx.editor;
    const node = editor.scene.nodeOfKind(event.target.nodeId, "glyph");
    const run = editor.scene.nodeOfKind(node?.parentId ?? null, "textRun");
    const object = editor.object(event.target.componentId);
    if (!node?.itemId || !run || object?.kind !== "component") return false;

    const afterId = node.itemId;
    const baseGlyphId = object.component.glyphId;
    const sourceId = node.sourceId;
    const open = () => {
      const record = editor.font.recordForId(baseGlyphId);
      if (!record) return;
      const item = glyphTextItem(record.name, record.unicodes[0] ?? null);
      if (!editor.text.insertAfter(run.runId, afterId, [item])) return;
      const child = editor.runChildren.editItem(run, item.id, sourceId);
      if (!child) return;
      editor.selection.clear();
      editor.editing.enter(child.id);
    };

    if (editor.glyphForId(baseGlyphId)) {
      editor.history.captureOrJoin("Open component base", open);
    } else {
      void editor.font
        .loadGlyph(baseGlyphId)
        .then(() => editor.history.capture("Open component base", open))
        .catch((error: unknown) => console.error("failed to load component base glyph", error));
    }
    return true;
  }
}
