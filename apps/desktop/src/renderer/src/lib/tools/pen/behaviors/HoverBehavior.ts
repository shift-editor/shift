import type { ToolEvent } from "../../core/GestureDetector";
import type { Editor } from "@/lib/editor";
import type { PenState, PenBehavior } from "../types";

export class HoverBehavior implements PenBehavior {
  canHandle(state: PenState, event: ToolEvent): boolean {
    return state.type === "ready" && event.type === "pointerMove";
  }

  transition(state: PenState, event: ToolEvent, editor: Editor): PenState | null {
    if (state.type !== "ready" || event.type !== "pointerMove") return null;

    editor.hitTest.updateHover(event.point);

    return {
      type: "ready",
      mousePos: event.point,
    };
  }
}
