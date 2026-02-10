import type { ToolEvent } from "../../core/GestureDetector";
import type { EditorAPI } from "../../core/EditorAPI";
import type { HandState } from "../types";
import { createBehavior } from "../../core/Behavior";

export const HandDraggingBehavior = createBehavior<HandState>({
  canHandle(state: HandState, event: ToolEvent): boolean {
    return (
      state.type === "dragging" &&
      (event.type === "drag" || event.type === "dragEnd" || event.type === "dragCancel")
    );
  },

  transition(state: HandState, event: ToolEvent, editor: EditorAPI) {
    if (state.type !== "dragging") return null;

    if (event.type === "drag") {
      const screenDelta = event.screenDelta;
      const newPan = {
        x: state.startPan.x + screenDelta.x,
        y: state.startPan.y + screenDelta.y,
      };
      editor.setPan(newPan.x, newPan.y);
      editor.requestRedraw();
      return { state };
    }

    if (event.type === "dragEnd" || event.type === "dragCancel") {
      return { state: { type: "ready" as const } };
    }

    return null;
  },
});
