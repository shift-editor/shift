import type { ToolEventOf } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/Behavior";
import type { SelectBehavior, SelectState } from "../types";

/**
 * Updates hover indicator on text run cells during pointer movement.
 *
 * Visual-only: returns false so subsequent pointer-move behaviors still run.
 * Uses advance-box hit-test (not shape-precise) — fine for hover highlight.
 */
export class TextRunHover implements SelectBehavior {
  onPointerMove(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"pointerMove">,
  ): boolean {
    if (state.type !== "ready" && state.type !== "selected") return false;

    const run = ctx.editor.textRun;
    const layout = run.$layout.peek();
    if (!layout) {
      run.interaction.setHovered(null);
      return false;
    }

    const hit = layout.hitTest(event.point, ctx.editor.hitRadius);
    run.interaction.setHovered(hit?.cluster ?? null);

    return false;
  }
}
