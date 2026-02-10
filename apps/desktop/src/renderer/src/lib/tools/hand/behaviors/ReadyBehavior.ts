import type { ToolEvent } from "../../core/GestureDetector";
import type { EditorAPI } from "../../core/EditorAPI";
import type { HandState } from "../types";
import { createBehavior } from "../../core/Behavior";

export const HandReadyBehavior = createBehavior<HandState>({
  canHandle(state: HandState, event: ToolEvent): boolean {
    return state.type === "ready" && event.type === "dragStart";
  },

  transition(state: HandState, event: ToolEvent, editor: EditorAPI) {
    if (state.type !== "ready" || event.type !== "dragStart") return null;
    const startPan = editor.pan;
    return {
      state: {
        type: "dragging" as const,
        screenStart: event.screenPoint,
        startPan,
      },
    };
  },
});
