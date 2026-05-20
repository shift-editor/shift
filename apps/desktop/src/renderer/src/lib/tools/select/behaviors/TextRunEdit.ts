import type { ToolEventOf } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/Behavior";
import type { SelectBehavior, SelectState } from "../types";

/**
 * Double-click on a text run item to enter in-place editing for that glyph.
 *
 * Resolves the click to a stable text-item anchor and lets Editor derive the
 * active glyph placement from the current layout. Linebreak items are not editable.
 */
export class TextRunEdit implements SelectBehavior {
  onDoubleClick(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"doubleClick">,
  ): boolean {
    if (state.type !== "ready") return false;

    const run = ctx.editor.textRun;
    const anchor = run.anchorAtPoint(event.point, ctx.editor.hitRadius);
    if (!anchor) return false;
    ctx.editor.setGlyphFocus(anchor);

    return true;
  }
}
