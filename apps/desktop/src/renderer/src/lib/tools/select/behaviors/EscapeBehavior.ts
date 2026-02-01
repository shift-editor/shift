import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { SelectState, SelectBehavior } from "../types";

export class EscapeBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    if (event.type !== "keyDown") return false;
    if (event.key !== "Escape") return false;
    return state.type === "selected" || state.type === "ready";
  }

  transition(state: SelectState, event: ToolEvent, _editor: ToolContext): SelectState | null {
    if (event.type !== "keyDown" || event.key !== "Escape") return null;

    if (state.type === "selected") {
      return {
        type: "ready",
        intent: { action: "clearSelection" },
      };
    }

    return null;
  }
}
