import type { ToolEvent } from "../../core/GestureDetector";
import type { Editor } from "@/lib/editor";
import type { SelectState, SelectBehavior } from "../types";

export class HoverBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    return (state.type === "ready" || state.type === "selected") && event.type === "pointerMove";
  }

  transition(_state: SelectState, event: ToolEvent, editor: Editor): SelectState | null {
    if (event.type !== "pointerMove") return null;

    editor.hitTest.updateHover(event.point);

    return null;
  }
}
