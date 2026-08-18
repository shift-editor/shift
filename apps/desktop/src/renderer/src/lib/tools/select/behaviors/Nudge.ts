import type { ToolContext } from "../../core/Behavior";
import type { KeyDownEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import { NUDGES_VALUES, type NudgeMagnitude } from "@/types/nudge";
import { PointRuleConstraint } from "@/lib/model/positions";

export class Nudge implements SelectBehavior {
  onKeyDown(state: SelectState, ctx: ToolContext<SelectState>, event: KeyDownEvent): boolean {
    if (state.type !== "ready") return false;

    const selection = ctx.editor.positionSelection(ctx.editor.selection.ids);
    if (!selection) return false;

    const pointIds = selection.targets.points ?? [];
    const anchorIds = selection.targets.anchors ?? [];
    if (pointIds.length === 0 && anchorIds.length === 0) return false;

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

    const edit = selection.layer.positions.move(selection.targets);
    if (pointIds.length > 0) {
      edit.constrainedBy(PointRuleConstraint.forSelection(selection.layer.geometry, pointIds));
    }
    edit.preview({ x: dx, y: dy });
    edit.commit();
    return true;
  }
}
