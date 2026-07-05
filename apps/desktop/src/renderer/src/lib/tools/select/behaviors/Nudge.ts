import type { ToolContext } from "../../core/Behavior";
import type { KeyDownEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import { NUDGES_VALUES, type NudgeMagnitude } from "@/types/nudge";
import { selectedGeometryEdit } from "./selectedGeometryEdit";

export class Nudge implements SelectBehavior {
  onKeyDown(state: SelectState, ctx: ToolContext<SelectState>, event: KeyDownEvent): boolean {
    if (state.type !== "ready") return false;

    const edit = selectedGeometryEdit(ctx.editor);
    if (!edit || edit.pointIds.length === 0) return false;

    const modifier: NudgeMagnitude = event.accelKey ? "large" : event.shiftKey ? "medium" : "small";
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

    edit.layer.movePoints(edit.pointIds, { x: dx, y: dy });
    return true;
  }
}
