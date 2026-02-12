import type { EditorAPI, ToolEvent, TransitionResult } from "../../core";
import type { TextAction, TextBehavior, TextState } from "../types";

export class TypingBehavior implements TextBehavior {
  canHandle(state: TextState, event: ToolEvent): boolean {
    return state.type === "typing" && event.type === "keyDown";
  }

  transition(
    state: TextState,
    event: ToolEvent,
    _editor: EditorAPI,
  ): TransitionResult<TextState, TextAction> | null {
    if (event.type !== "keyDown") return null;
    if (state.type !== "typing") return null;

    switch (event.key) {
      case "Backspace":
        return { state: { ...state }, action: { type: "delete" } };
      case "Escape":
        return { state: { type: "idle" }, action: { type: "cancel" } };
      case "ArrowLeft":
        return { state: { ...state }, action: { type: "moveLeft" } };
      case "ArrowRight":
        return { state: { ...state }, action: { type: "moveRight" } };
      default: {
        if (event.key.length !== 1 || event.metaKey) return null;
        const codepoint = event.key.codePointAt(0);
        if (codepoint === undefined) return null;
        return { state: { ...state }, action: { type: "insert", codepoint } };
      }
    }
  }
}
