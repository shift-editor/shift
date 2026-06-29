import type { ToolContext } from "../../core/Behavior";
import type { DoubleClickEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

export class SegmentDoubleClick implements SelectBehavior {
  onDoubleClick(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: DoubleClickEvent,
  ): boolean {
    if (state.type !== "ready") return false;
    if (event.target.kind != "segment") return false;

    const activeSourceId = ctx.editor.activeSourceId;
    if (!activeSourceId) return false;

    const layer = ctx.editor.font.layer(event.target.glyphId, activeSourceId);
    if (!layer) return false;

    const firstPoint = event.target.pointIds[0];
    if (!firstPoint) return false;

    const contourId = layer.contourIdOfPoint(firstPoint);
    if (!contourId) return false;

    const contour = layer.contour(contourId);
    if (!contour) return false;

    ctx.editor.selection.clear();
    ctx.editor.selection.select([
      { kind: "contour", contourId },
      ...contour.points.map((point) => ({
        kind: "point" as const,
        pointId: point.id,
      })),
    ]);
    return true;
  }
}
