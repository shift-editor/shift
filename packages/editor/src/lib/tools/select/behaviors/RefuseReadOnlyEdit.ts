import type { ToolContext } from "../../core/Behavior";
import type { DoubleClickEvent, DragStartEvent, KeyDownEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import { nudgeDelta } from "./Nudge";

/**
 * Says a read-only font is read-only when a gesture would edit geometry that
 * has nothing to edit: a compiled font's preview (TrueType, OpenType), whose
 * glyphs are drawn from compiled outlines with no layer behind them.
 *
 * @remarks
 * Last in the chain: an editable layer's gesture is taken by the behaviour
 * that edits it, and a read-only font refuses that edit itself
 * (`Font.refuseEdits`). Only what no behaviour took reaches here: a drag
 * from a point, segment or anchor, which would otherwise start a marquee; a
 * nudge; and a double-click on a point.
 */
export class RefuseReadOnlyEdit implements SelectBehavior {
  onDragStart(state: SelectState, ctx: ToolContext<SelectState>, event: DragStartEvent): boolean {
    if (state.type !== "ready" || !ctx.editor.font.refusesEdits) return false;
    switch (event.target.kind) {
      case "point":
      case "segment":
      case "anchor":
        ctx.editor.notifyPreviewMutationAttempt();
        return true;
      default:
        return false;
    }
  }

  onKeyDown(state: SelectState, ctx: ToolContext<SelectState>, event: KeyDownEvent): boolean {
    if (state.type !== "ready" || !ctx.editor.font.refusesEdits) return false;
    if (!nudgeDelta(event) || !ctx.editor.selection.hasSelection()) return false;
    ctx.editor.notifyPreviewMutationAttempt();
    return true;
  }

  onDoubleClick(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: DoubleClickEvent,
  ): boolean {
    if (state.type !== "ready" || !ctx.editor.font.refusesEdits) return false;
    if (event.target.kind !== "point") return false;
    ctx.editor.notifyPreviewMutationAttempt();
    return true;
  }
}
