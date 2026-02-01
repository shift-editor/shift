import { Contours } from "@shift/geo";
import type { ToolEvent } from "../../core/GestureDetector";
import type { Editor } from "@/lib/editor";
import type { PenState, PenBehavior } from "../types";

export class EscapeBehavior implements PenBehavior {
  canHandle(state: PenState, event: ToolEvent): boolean {
    return state.type === "ready" && event.type === "keyDown" && event.key === "Escape";
  }

  transition(state: PenState, event: ToolEvent, editor: Editor): PenState | null {
    if (state.type !== "ready") return null;
    if (event.type !== "keyDown" || event.key !== "Escape") return null;

    if (this.hasActiveDrawingContour(editor)) {
      return {
        ...state,
        intent: { action: "abandonContour" },
      };
    }

    return null;
  }

  private hasActiveDrawingContour(editor: Editor): boolean {
    const contour = editor.edit.getActiveContour();
    if (!contour) return false;
    return Contours.isOpen(contour) && !Contours.isEmpty(contour);
  }
}
