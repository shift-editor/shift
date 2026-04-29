import type { ToolEventOf } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/Behavior";
import type { SelectBehavior, SelectState } from "../types";

/**
 * Stub: double-click-to-edit-glyph against the new TextRun API. Re-add the
 * real implementation in a follow-up — it needs `layout.shapeHitTest`
 * (currently still a throw stub) and the composite-component drill-through
 * we deferred. Returns false to defer to the regular double-click handler.
 */
export class TextRunEdit implements SelectBehavior {
  onDoubleClick(
    state: SelectState,
    _ctx: ToolContext<SelectState>,
    _event: ToolEventOf<"doubleClick">,
  ): boolean {
    if (state.type !== "ready" && state.type !== "selected") return false;
    return false;
  }
}
