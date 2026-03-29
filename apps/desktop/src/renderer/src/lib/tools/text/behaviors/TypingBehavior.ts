import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { TextState, TextBehavior } from "../types";
import { layoutText } from "../TextLayout";

export class TypingBehavior implements TextBehavior {
  canHandle(state: TextState, event: ToolEvent): boolean {
    return state.type === "typing" && event.type === "keyDown";
  }

  transition(state: TextState, event: ToolEvent, editor: ToolContext): TextState | null {
    if (event.type !== "keyDown" || state.type !== "typing") return null;

    switch (event.key) {
      case "Backspace": {
        if (state.cursorIndex <= 0) return null;
        const chars = [...state.text];
        chars.splice(state.cursorIndex - 1, 1);
        const newText = chars.join("");
        return {
          type: "typing",
          text: newText,
          cursorIndex: state.cursorIndex - 1,
          layout: layoutText(newText, editor, state.layout),
        };
      }

      case "Delete": {
        const chars = [...state.text];
        if (state.cursorIndex >= chars.length) return null;
        chars.splice(state.cursorIndex, 1);
        const newText = chars.join("");
        return {
          type: "typing",
          text: newText,
          cursorIndex: state.cursorIndex,
          layout: layoutText(newText, editor, state.layout),
        };
      }

      case "ArrowLeft":
        if (state.cursorIndex <= 0) return null;
        return { ...state, cursorIndex: state.cursorIndex - 1 };

      case "ArrowRight": {
        const chars = [...state.text];
        if (state.cursorIndex >= chars.length) return null;
        return { ...state, cursorIndex: state.cursorIndex + 1 };
      }

      case "Home":
        if (state.cursorIndex === 0) return null;
        return { ...state, cursorIndex: 0 };

      case "End": {
        const len = [...state.text].length;
        if (state.cursorIndex === len) return null;
        return { ...state, cursorIndex: len };
      }

      default: {
        if (event.key.length !== 1 || event.metaKey) return null;

        const chars = [...state.text];
        chars.splice(state.cursorIndex, 0, event.key);
        const newText = chars.join("");
        return {
          type: "typing",
          text: newText,
          cursorIndex: state.cursorIndex + 1,
          layout: layoutText(newText, editor, state.layout),
        };
      }
    }
  }
}
