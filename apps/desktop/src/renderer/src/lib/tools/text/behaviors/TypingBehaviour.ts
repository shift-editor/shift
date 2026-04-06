import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { TextBehavior, TextState } from "../types";

export class TypingBehavior implements TextBehavior {
  onKeyDown(state: TextState, ctx: ToolContext<TextState>, event: ToolEventOf<"keyDown">): boolean {
    if (state.type !== "typing") return false;

    switch (event.key) {
      case "Backspace":
        if (ctx.editor.deleteTextCodepoint()) {
          ctx.editor.recomputeTextRun();
        }
        return true;
      case "Escape":
        ctx.setState({ type: "idle" });
        ctx.editor.setActiveTool("select");
        return true;
      case "ArrowLeft":
        if (ctx.editor.moveTextCursorLeft()) {
          ctx.editor.recomputeTextRun();
        }
        return true;
      case "ArrowRight":
        if (ctx.editor.moveTextCursorRight()) {
          ctx.editor.recomputeTextRun();
        }
        return true;
      default: {
        if (event.key.length !== 1 || event.metaKey) return false;
        const codepoint = event.key.codePointAt(0);
        if (codepoint === undefined) return false;
        ctx.editor.insertTextCodepoint(codepoint);
        ctx.editor.recomputeTextRun();
        return true;
      }
    }
  }
}
