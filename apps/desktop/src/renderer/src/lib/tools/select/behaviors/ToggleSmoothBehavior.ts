import type { ToolEvent } from "../../core/GestureDetector";
import type { Editor } from "@/lib/editor";
import type { SelectState, SelectBehavior } from "../types";

export class ToggleSmoothBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    return (state.type === "ready" || state.type === "selected") && event.type === "doubleClick";
  }

  transition(state: SelectState, event: ToolEvent, editor: Editor): SelectState | null {
    if (event.type !== "doubleClick") return null;
    if (state.type !== "ready" && state.type !== "selected") return null;

    const hit = editor.getPointAt(event.point);
    if (hit && hit.pointType === "onCurve") {
      return {
        ...state,
        intent: { action: "toggleSmooth", pointId: hit.id },
      };
    }
    return null;
  }
}
