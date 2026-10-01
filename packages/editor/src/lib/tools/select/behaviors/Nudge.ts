import { Mat, type Point2D } from "@shift/geo";

import type { ToolContext } from "../../core/Behavior";
import type { KeyDownEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import { NUDGES_VALUES, nudgeMagnitude } from "../../../../types/nudge";
import { PointRuleConstraint, PositionEdits } from "../../../model/positions/index";
import { pointSlide } from "../PointSlide";

export class Nudge implements SelectBehavior {
  onKeyDown(state: SelectState, ctx: ToolContext<SelectState>, event: KeyDownEvent): boolean {
    if (state.type !== "ready") return false;

    const delta = nudgeDelta(event);
    if (!delta) return false;

    const components = ctx.editor.componentTransformSelection(ctx.editor.selection.ids);
    if (components) {
      const edit = components.layer.beginComponentTransformEdit(components);
      edit.preview(() => Mat.Translate(delta.x, delta.y));
      edit.commit("Move components");
      return true;
    }

    const selection = ctx.editor.positionSelection(ctx.editor.selection.ids);
    if (!selection) return false;

    const pointIds = selection.targets.points ?? [];
    const anchorIds = selection.targets.anchors ?? [];
    if (pointIds.length === 0 && anchorIds.length === 0) return false;

    const [onlyPointId] = pointIds;
    const slidesAlone = event.altKey && pointIds.length === 1 && anchorIds.length === 0;
    const slide = slidesAlone && onlyPointId ? pointSlide(selection.layer, onlyPointId) : null;

    const edit = PositionEdits.fromSelection(selection).move(selection.targets);
    if (slide) edit.along(slide.axis);

    const handlesFollow = slide?.handlesFollow ?? true;
    if (pointIds.length > 0 && handlesFollow) {
      edit.constrainedBy(PointRuleConstraint.forSelection(selection.layer.geometry, pointIds));
    }
    edit.preview(delta);
    edit.commit();
    return true;
  }
}

function nudgeDelta(event: KeyDownEvent): Point2D | null {
  const nudgeValue =
    NUDGES_VALUES[nudgeMagnitude({ accel: event.accelKey, shift: event.shiftKey })];

  switch (event.key) {
    case "ArrowLeft":
      return { x: -nudgeValue, y: 0 };
    case "ArrowRight":
      return { x: nudgeValue, y: 0 };
    case "ArrowUp":
      return { x: 0, y: nudgeValue };
    case "ArrowDown":
      return { x: 0, y: -nudgeValue };
    default:
      return null;
  }
}
