import type { ToolEventOf } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/Behavior";
import type { SelectBehavior, SelectState } from "../types";

/**
 * Stub: visual-only hover indicator on text run cells. Re-add real hit-test
 * logic against the new TextRun API in a follow-up. Returns false so other
 * pointer-move behaviors still run.
 */
export class TextRunHover implements SelectBehavior {
  onPointerMove(
    state: SelectState,
    _ctx: ToolContext<SelectState>,
    _event: ToolEventOf<"pointerMove">,
  ): boolean {
    if (state.type !== "ready" && state.type !== "selected") return false;
    return false;
  }
}
