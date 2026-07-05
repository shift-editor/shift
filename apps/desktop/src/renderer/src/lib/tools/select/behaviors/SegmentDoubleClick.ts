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

    const node = ctx.editor.scene.node(event.target.nodeId);
    if (node?.kind !== "glyph") return false;

    const layer = ctx.editor.font.layer(node.glyphId, node.sourceId);
    if (!layer) return false;

    const firstPoint = event.target.pointIds[0];
    if (!firstPoint) return false;

    const contourId = layer.contourIdOfPoint(firstPoint);
    if (!contourId) return false;

    const contour = layer.contour(contourId);
    if (!contour) return false;

    ctx.editor.selection.clear();
    ctx.editor.selection.select([contourId, ...contour.points.map((point) => point.id)]);
    return true;
  }
}
