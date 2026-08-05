import { Validate } from "@shift/validation";
import type { ToolContext } from "../../core/Behavior";
import type { DoubleClickEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import { objectIsKindOf } from "@/types";

export class ToggleSmooth implements SelectBehavior {
  onDoubleClick(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: DoubleClickEvent,
  ): boolean {
    if (state.type !== "ready") return false;
    if (event.target.kind !== "point") return false;

    const object = ctx.editor.object(event.target.id);
    if (!objectIsKindOf(object, "point")) return false;

    const layer = ctx.editor.layerForGeometry({ points: [object.pointId] });
    if (!layer || layer.sourceId !== ctx.editor.activeSourceId) return false;

    const point = layer.point(object.pointId);
    if (!point || !Validate.isOnCurve(point)) return false;

    layer.toggleSmooth(object.pointId);
    return true;
  }
}
