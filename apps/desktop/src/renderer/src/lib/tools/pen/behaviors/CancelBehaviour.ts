import { Contours } from "@shift/font";
import type { ToolEvent } from "../../core/GestureDetector";
import type { EditorAPI } from "../../core/EditorAPI";
import type { TransitionResult } from "../../core/Behavior";
import type { PenState, PenBehavior } from "../types";
import type { PenAction } from "../actions";

export class EscapeBehavior implements PenBehavior {
  canHandle(state: PenState, event: ToolEvent): boolean {
    return state.type === "ready" && event.type === "keyDown" && event.key === "Escape";
  }

  transition(
    state: PenState,
    event: ToolEvent,
    editor: EditorAPI,
  ): TransitionResult<PenState, PenAction> | null {
    if (state.type !== "ready") return null;
    if (event.type !== "keyDown" || event.key !== "Escape") return null;

    if (this.hasActiveDrawingContour(editor)) {
      return {
        state: { type: state.type, mousePos: state.mousePos },
        action: { type: "abandonContour" },
      };
    }

    return null;
  }

  private hasActiveDrawingContour(editor: EditorAPI): boolean {
    const contour = editor.getActiveContour();
    if (!contour) return false;
    return Contours.isOpen(contour) && !Contours.isEmpty(contour);
  }
}
