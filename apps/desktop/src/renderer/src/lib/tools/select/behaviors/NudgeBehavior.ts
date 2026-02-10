import type { ToolEvent } from "../../core/GestureDetector";
import type { EditorAPI } from "../../core/EditorAPI";
import type { TransitionResult } from "../../core/Behavior";
import type { SelectState, SelectBehavior } from "../types";
import type { SelectAction } from "../actions";
import { NUDGES_VALUES, type NudgeMagnitude } from "@/types/nudge";

export class NudgeBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    if (state.type !== "selected") return false;
    if (event.type !== "keyDown") return false;

    const arrowKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    return arrowKeys.includes(event.key);
  }

  transition(
    state: SelectState,
    event: ToolEvent,
    editor: EditorAPI,
  ): TransitionResult<SelectState, SelectAction> | null {
    if (state.type !== "selected") return null;
    if (event.type !== "keyDown") return null;

    const pointIds = editor.getSelectedPoints();
    if (pointIds.length === 0) return null;

    const modifier: NudgeMagnitude = event.metaKey ? "large" : event.shiftKey ? "medium" : "small";
    const nudgeValue = NUDGES_VALUES[modifier];

    let dx = 0;
    let dy = 0;

    switch (event.key) {
      case "ArrowLeft":
        dx = -nudgeValue;
        break;
      case "ArrowRight":
        dx = nudgeValue;
        break;
      case "ArrowUp":
        dy = nudgeValue;
        break;
      case "ArrowDown":
        dy = -nudgeValue;
        break;
      default:
        return null;
    }

    return {
      state: { ...state },
      action: { type: "nudge", dx, dy, pointIds: [...pointIds] },
    };
  }
}
