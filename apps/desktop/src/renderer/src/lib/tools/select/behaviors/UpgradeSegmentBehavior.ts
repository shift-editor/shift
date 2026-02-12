import type { ToolEvent } from "../../core/GestureDetector";
import type { EditorAPI } from "../../core/EditorAPI";
import type { TransitionResult } from "../../core/Behavior";
import type { SelectState, SelectBehavior } from "../types";
import type { SelectAction } from "../actions";
import { isSegmentHit } from "@/types/hitResult";

export class UpgradeSegmentBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    return (
      (state.type === "ready" || state.type === "selected") &&
      event.type === "click" &&
      event.altKey
    );
  }

  transition(
    state: SelectState,
    event: ToolEvent,
    editor: EditorAPI,
  ): TransitionResult<SelectState, SelectAction> | null {
    if (event.type !== "click" || !event.altKey) return null;

    const hit = editor.getNodeAt(event.coords);
    if (!isSegmentHit(hit) || hit.segment.type !== "line") return null;

    return {
      state: { type: state.type === "selected" ? "selected" : "ready" },
      action: { type: "upgradeLineToCubic", segment: hit.segment },
    };
  }
}
