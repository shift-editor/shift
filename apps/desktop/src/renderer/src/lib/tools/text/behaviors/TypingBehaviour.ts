import type { ToolEventOf } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/Behavior";
import type { TextBehavior, TextState } from "../types";

/**
 * Minimal typing behavior. Real keyboard input flows through
 * `HiddenTextInput.tsx` directly to `editor.textRun.{insert,delete,...}`;
 * this behavior exists so the Text tool has a registered behavior slot
 * (state-machine compliance) and can intercept Escape via the tool layer
 * if needed.
 */
export class TypingBehavior implements TextBehavior {
  onKeyDown(state: TextState, ctx: ToolContext<TextState>, event: ToolEventOf<"keyDown">): boolean {
    if (state.type !== "typing") return false;
    if (event.key === "Escape") {
      ctx.editor.setActiveTool("select");
      return true;
    }
    return false;
  }
}
