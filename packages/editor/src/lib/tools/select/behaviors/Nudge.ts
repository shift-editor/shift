import type { ToolContext } from "../../core/Behavior";
import type { KeyDownEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import { NUDGES_VALUES, nudgeMagnitude } from "../../../../types/nudge";
import { PointRuleConstraint, PositionEdits } from "../../../model/positions/index";
import { pointSlide } from "../PointSlide";

export class Nudge implements SelectBehavior {
  onKeyDown(state: SelectState, ctx: ToolContext<SelectState>, event: KeyDownEvent): boolean {
    if (state.type !== "ready") return false;

    const selection = ctx.editor.positionSelection(ctx.editor.selection.ids);
    if (!selection) return false;

    const pointIds = selection.targets.points ?? [];
    const anchorIds = selection.targets.anchors ?? [];
    if (pointIds.length === 0 && anchorIds.length === 0) return false;

    const nudgeValue =
      NUDGES_VALUES[nudgeMagnitude({ accel: event.accelKey, shift: event.shiftKey })];

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

    const [onlyPointId] = pointIds;
    const slidesAlone = event.altKey && pointIds.length === 1 && anchorIds.length === 0;
    const slide = slidesAlone && onlyPointId ? pointSlide(selection.layer, onlyPointId) : null;

    const edit = PositionEdits.fromSelection(selection).move(selection.targets);
    if (slide) edit.along(slide.axis);

    const handlesFollow = slide?.handlesFollow ?? true;
    if (pointIds.length > 0 && handlesFollow) {
      edit.constrainedBy(PointRuleConstraint.forSelection(selection.layer.geometry, pointIds));
    }
    edit.preview({ x: dx, y: dy });
    edit.commit();
    return true;
  }
}
