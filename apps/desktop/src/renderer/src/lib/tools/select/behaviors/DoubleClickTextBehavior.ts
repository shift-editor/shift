import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { SelectState, SelectBehavior } from "../types";

export class DoubleClickTextBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    return (state.type === "ready" || state.type === "selected") && event.type === "doubleClick";
  }

  transition(_state: SelectState, event: ToolEvent, editor: ToolContext): SelectState | null {
    if (event.type !== "doubleClick") return null;

    const glyphIndex = editor.hitTestTextContentIndex(event.point);
    if (glyphIndex === null) return null;

    return {
      type: "ready",
      intent: { action: "resumeTextEditing", glyphIndex },
    };
  }
}
