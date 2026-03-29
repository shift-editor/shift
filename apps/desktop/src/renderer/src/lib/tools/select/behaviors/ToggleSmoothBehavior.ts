import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectHandlerBehavior, SelectState } from "../types";
import { getPointIdFromHit } from "@/types/hitResult";

export class ToggleSmoothBehavior implements SelectHandlerBehavior {
  onDoubleClick(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"doubleClick">,
  ): boolean {
    if (state.type !== "ready" && state.type !== "selected") return false;

    const hit = ctx.editor.getNodeAt(event.coords);
    const pointId = getPointIdFromHit(hit);
    if (pointId === null) return false;

    const point = ctx.editor.getAllPoints().find((p) => p.id === pointId);
    if (!point || point.pointType !== "onCurve") return false;

    ctx.editor.toggleSmooth(pointId);
    return true;
  }
}
