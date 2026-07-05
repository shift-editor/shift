import type { KeyDownEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/Behavior";
import type { TextBehavior, TextState } from "../types";

/**
 * Escape via the tool layer (most keys go through `HiddenTextInput` while the
 * text tool is active).
 */
export class TypingBehavior implements TextBehavior {
  onKeyDown(state: TextState, ctx: ToolContext<TextState>, event: KeyDownEvent): boolean {
    if (state.type !== "typing") return false;
    if (event.key === "Escape") {
      ctx.editor.setActiveTool("select");
      return true;
    }
    return false;
  }
}
