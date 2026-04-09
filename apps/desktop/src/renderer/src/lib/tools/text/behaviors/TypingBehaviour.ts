import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { TextBehavior, TextState } from "../types";

/**
 * Handles tool-level keyboard events for the text tool.
 *
 * Character input, arrows, backspace, clipboard, and IME are handled by the
 * hidden textarea (HiddenTextInput component). This behavior only handles
 * events that affect tool state (Escape to exit).
 */
export class TypingBehavior implements TextBehavior {
  onKeyDown(state: TextState, ctx: ToolContext<TextState>, event: ToolEventOf<"keyDown">): boolean {
    if (state.type !== "typing") return false;

    switch (event.key) {
      case "Escape":
        ctx.setState({ type: "idle" });
        ctx.editor.setActiveTool("select");
        return true;
      default:
        return false;
    }
  }
}
