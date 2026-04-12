import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectHandlerBehavior, SelectState } from "../types";
import { NUDGES_VALUES, type NudgeMagnitude } from "@/types/nudge";

export class NudgeBehavior implements SelectHandlerBehavior {
  onKeyDown(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"keyDown">,
  ): boolean {
    if (state.type !== "selected") return false;

    const pointIds = [...ctx.editor.selection.pointIds];
    if (pointIds.length === 0) return false;

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
        return false;
    }

    ctx.editor.nudgePoints(pointIds, dx, dy);
    return true;
  }
}
