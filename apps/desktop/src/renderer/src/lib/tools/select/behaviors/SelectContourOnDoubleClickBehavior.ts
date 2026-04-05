import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { EditorAPI } from "../../core/EditorAPI";
import type { SelectHandlerBehavior, SelectState } from "../types";
import type { PointId } from "@shift/types";
import type { SegmentId } from "@/types/indicator";
import { Segments as SegmentOps } from "@/lib/geo/Segments";
import { isSegmentHit } from "@/types/hitResult";

export class SelectContourOnDoubleClickBehavior implements SelectHandlerBehavior {
  onDoubleClick(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"doubleClick">,
  ): boolean {
    if (state.type !== "ready" && state.type !== "selected") return false;

    const hit = ctx.editor.getNodeAt(event.coords);
    if (!isSegmentHit(hit)) return false;

    const pointIds = this.findContourPointIdsForSegment(hit.segmentId, ctx.editor);
    if (!pointIds) return false;

    ctx.editor.clearSelection();
    ctx.editor.selectPoints(pointIds);
    ctx.setState({ type: "selected" });
    return true;
  }

  private findContourPointIdsForSegment(segmentId: SegmentId, editor: EditorAPI): PointId[] | null {
    const glyph = editor.glyph.peek();
    if (!glyph) return null;

    for (const contour of glyph.contours) {
      const segments = SegmentOps.parse(contour.points, contour.closed);
      for (const seg of segments) {
        if (SegmentOps.id(seg) === segmentId) {
          return contour.points.map((point) => point.id);
        }
      }
    }

    return null;
  }
}
