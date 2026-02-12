import type { ToolEvent } from "../../core/GestureDetector";
import type { EditorAPI } from "../../core/EditorAPI";
import type { TransitionResult } from "../../core/Behavior";
import type { SelectState, SelectBehavior } from "../types";
import type { SelectAction } from "../actions";
import { hitTestTextSlot } from "../../text/layout";

/**
 * Handles double-click on a text run glyph to switch it to in-place editing.
 *
 * Takes priority over the normal double-click-select-contour behavior
 * when a text run is active.
 */
export class TextRunEditBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    return (state.type === "ready" || state.type === "selected") && event.type === "doubleClick";
  }

  transition(
    state: SelectState,
    event: ToolEvent,
    editor: EditorAPI,
  ): TransitionResult<SelectState, SelectAction> | null {
    if (event.type !== "doubleClick") return null;

    const textRunState = editor.textRunManager.state.peek();
    if (!textRunState) return null;

    const metrics = editor.font.getMetrics();
    const hitIndex = hitTestTextSlot(textRunState.layout, event.point, metrics, {
      outlineRadius: editor.hitRadius,
      includeFill: true,
      requireShape: true,
    });
    if (hitIndex === null) return null;

    return {
      state: { ...state },
      action: { type: "editTextRunSlot", index: hitIndex },
    };
  }
}
