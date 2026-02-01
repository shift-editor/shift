import type { ToolEvent } from "../../core/GestureDetector";
import type { Editor } from "@/lib/editor";
import type { PenState, PenBehavior } from "../types";

/**
 * Simple behavior that tracks mouse position in the ready state.
 * This enables the Pen tool to render preview lines and update cursors.
 *
 * Note: Hover state is managed automatically by the Editor.
 * This behavior only tracks the mouse position and triggers cursor updates
 * via the onTransition callback in the Pen tool.
 */
export class MouseTrackBehavior implements PenBehavior {
  canHandle(state: PenState, event: ToolEvent): boolean {
    return state.type === "ready" && event.type === "pointerMove";
  }

  transition(state: PenState, event: ToolEvent, _editor: Editor): PenState | null {
    if (state.type !== "ready" || event.type !== "pointerMove") return null;

    // Simply update mousePos - cursor will be updated in onTransition
    return {
      ...state,
      mousePos: event.point,
    };
  }
}
