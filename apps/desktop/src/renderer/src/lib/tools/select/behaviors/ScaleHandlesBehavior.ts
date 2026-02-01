import type { ToolEvent } from "../../core/GestureDetector";
import type { Editor } from "@/lib/editor";
import type { SelectState, SelectBehavior } from "../types";

/**
 * Scale handle lengths using keyboard shortcuts.
 *
 * `>` (Shift+.) increases handle length
 * `<` (Shift+,) decreases handle length
 *
 * Only affects selected off-curve (control) points.
 * Preserves handle direction while scaling magnitude.
 *
 * Modifiers:
 * - Default: scale by 5 units
 * - Shift already pressed for < or >
 * - Cmd/Ctrl: scale by 50 units (large step)
 * - Alt: scale by 1 unit (fine step)
 */
export class ScaleHandlesBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    if (state.type !== "selected") return false;
    if (event.type !== "keyDown") return false;

    // Check for > (scale up) or < (scale down)
    // These require shift to be held (Shift+. = >, Shift+, = <)
    return event.key === ">" || event.key === "<";
  }

  transition(state: SelectState, event: ToolEvent, editor: Editor): SelectState | null {
    if (state.type !== "selected") return null;
    if (event.type !== "keyDown") return null;

    const pointIds = editor.selection.getSelectedPoints();
    if (pointIds.length === 0) return null;

    // Determine scale factor based on key and modifiers
    // > increases, < decreases
    const direction = event.key === ">" ? 1 : -1;

    // Step size based on modifiers
    // Alt = fine (1 unit), Cmd/Ctrl = large (50 units), default = 5 units
    let step: number;
    if (event.altKey) {
      step = 1;
    } else if (event.metaKey) {
      step = 50;
    } else {
      step = 5;
    }

    const scaleDelta = direction * step;

    return {
      ...state,
      intent: { action: "scaleHandles", pointIds: [...pointIds], scaleDelta },
    };
  }
}
