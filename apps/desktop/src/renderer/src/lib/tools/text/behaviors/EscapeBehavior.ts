import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { TextState, TextBehavior } from "../types";

export class EscapeBehavior implements TextBehavior {
  canHandle(state: TextState, event: ToolEvent): boolean {
    return state.type === "typing" && event.type === "keyDown" && event.key === "Escape";
  }

  transition(state: TextState, event: ToolEvent, _editor: ToolContext): TextState | null {
    if (event.type !== "keyDown" || event.key !== "Escape") return null;
    if (state.type !== "typing") return null;
    return { type: "ready" };
  }
}
