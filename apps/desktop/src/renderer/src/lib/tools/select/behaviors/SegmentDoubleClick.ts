import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

export class SegmentDoubleClick implements SelectBehavior {
  onDoubleClick(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"doubleClick">,
  ): boolean {
    if (state.type !== "ready") return false;

    const source = ctx.editor.editGlyphSource;
    if (!source) return false;

    const geometry = source.geometry;
    const segmentHit = geometry.hitSegment(
      event.coords.glyphLocal,
      ctx.editor.hitRadius,
    );
    if (!segmentHit) return false;

    const segment = geometry.segment(segmentHit.segmentId);
    if (!segment) return false;

    ctx.editor.selectAll();
    return true;
  }
}
