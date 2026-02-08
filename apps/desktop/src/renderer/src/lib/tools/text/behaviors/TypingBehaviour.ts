import { ToolContext, ToolEvent, TransitionResult } from "../../core";
import { TextAction, TextBehavior, TextState } from "../types";

export class TypingBehavior implements TextBehavior {
  canHandle(state: TextState, _event: ToolEvent): boolean {
    return state.type === "typing";
  }

  transition(
    state: TextState,
    event: ToolEvent,
    _editor: ToolContext,
  ): TransitionResult<TextState, TextAction> | null {
    if (event.type !== "keyDown") return null;
    if (state.type !== "typing") return null;

    const { layout } = state;

    console.log(event.key);

    switch (event.key) {
      case "Backspace":
        return {
          state: { type: "typing", layout: layout },
          action: { type: "delete" },
        };
      case "Escape":
        return {
          state: { type: "idle" },
          action: { type: "cancel" },
        };
      case "ArrowLeft":
        return {
          state: { type: "typing", layout: { slots: [], totalAdvance: 0 } },
          action: { type: "moveLeft" },
        };
      case "ArrowRight":
        return {
          state: { type: "typing", layout: { slots: [], totalAdvance: 0 } },
          action: { type: "moveRight" },
        };
      default:
        return {
          state: {
            type: "typing",
            layout: { slots: [], totalAdvance: 0 },
          },
          action: { type: "insert", codepoint: event.key.codePointAt(0) },
        };
    }
  }

  onTransition(_prev: TextState, _next: TextState, _event: ToolEvent): void {}
}
