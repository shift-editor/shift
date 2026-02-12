import type { ToolEvent } from "../../core/GestureDetector";
import type { EditorAPI } from "../../core/EditorAPI";
import type { TransitionResult } from "../../core/Behavior";
import type { SelectState, SelectBehavior } from "../types";
import type { SelectAction } from "../actions";
import { hitTestTextSlot } from "../../text/layout";

/**
 * Updates hover indicator on text run glyphs during pointer movement.
 *
 * This is a visual-only behavior — it always returns null so that
 * subsequent behaviors can also process the pointer move event.
 */
export class TextRunHoverBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    return (state.type === "ready" || state.type === "selected") && event.type === "pointerMove";
  }

  transition(
    _state: SelectState,
    event: ToolEvent,
    editor: EditorAPI,
  ): TransitionResult<SelectState, SelectAction> | null {
    if (event.type !== "pointerMove") return null;

    const textRunState = editor.textRunManager.state.peek();
    if (!textRunState) return null;

    const metrics = editor.font.getMetrics();
    const hitIndex = hitTestTextSlot(textRunState.layout, event.point, metrics, {
      outlineRadius: editor.hitRadius,
      includeFill: true,
      requireShape: true,
    });

    editor.textRunManager.setHovered(hitIndex);

    // Return null to let other behaviors also process this event
    return null;
  }
}
