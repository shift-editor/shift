import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { TransitionResult } from "../../core/Behavior";
import type { SelectState, SelectBehavior } from "../types";
import type { SelectAction } from "../actions";

export class EscapeBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    if (event.type !== "keyDown") return false;
    if (event.key !== "Escape") return false;
    return state.type === "selected" || state.type === "ready";
  }

  transition(
    state: SelectState,
    event: ToolEvent,
    _editor: ToolContext,
  ): TransitionResult<SelectState, SelectAction> | null {
    if (event.type !== "keyDown" || event.key !== "Escape") return null;

    if (state.type === "selected") {
      return {
        state: { type: "ready" },
        action: { type: "clearSelection" },
      };
    }

    return null;
  }
}
