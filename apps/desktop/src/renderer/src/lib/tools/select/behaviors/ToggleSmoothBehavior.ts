import type { ToolEvent } from "../../core/GestureDetector";
import type { EditorAPI } from "../../core/EditorAPI";
import type { TransitionResult } from "../../core/Behavior";
import type { SelectState, SelectBehavior } from "../types";
import type { SelectAction } from "../actions";
import { getPointIdFromHit } from "@/types/hitResult";

export class ToggleSmoothBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    return (state.type === "ready" || state.type === "selected") && event.type === "doubleClick";
  }

  transition(
    state: SelectState,
    event: ToolEvent,
    editor: EditorAPI,
  ): TransitionResult<SelectState, SelectAction> | null {
    if (event.type !== "doubleClick") return null;
    if (state.type !== "ready" && state.type !== "selected") return null;

    const hit = editor.getNodeAt(event.point);
    const pointId = getPointIdFromHit(hit);
    if (pointId === null) return null;

    const point = editor.getAllPoints().find((p) => p.id === pointId);
    if (!point || point.pointType !== "onCurve") return null;

    return {
      state: { ...state },
      action: { type: "toggleSmooth", pointId },
    };
  }
}
