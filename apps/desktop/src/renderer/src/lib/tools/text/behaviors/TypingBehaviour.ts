import { ToolContext, ToolEvent, TransitionResult } from "../../core";
import { TextAction, TextBehavior, TextState } from "../types";

export class TypingBehavior implements TextBehavior {
  canHandle(state: TextState, _event: ToolEvent): boolean {
    return state.type === "typing";
  }

  transition(
    _state: TextState,
    event: ToolEvent,
    _editor: ToolContext,
  ): TransitionResult<TextState, TextAction> | null {
    if (event.type !== "keyDown") return null;

    switch (event.key) {
      case "Backspace":
        return { state: { type: "typing" }, action: { type: "delete" } };
      case "Escape":
        return { state: { type: "idle" }, action: { type: "cancel" } };
      case "ArrowLeft":
        return { state: { type: "typing" }, action: { type: "moveLeft" } };
      case "ArrowRight":
        return { state: { type: "typing" }, action: { type: "moveRight" } };
      default:
        return null;
    }
  }

  onTransition(_prev: TextState, _next: TextState, _event: ToolEvent): void {}
}
