import type { ToolEventOf } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/Behavior";
import type { SelectBehavior, SelectState } from "../types";

export class UpgradeSegment implements SelectBehavior {
  onClick(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"click">,
  ): boolean {
    if (state.type !== "ready" || !event.altKey) return false;

    const source = ctx.editor.editGlyphSource;
    if (!source) return false;

    const geometry = source.geometry;
    const hit = geometry.hitSegment(
      event.coords.glyphLocal,
      ctx.editor.hitRadius,
    );
    if (!hit) return false;

    const segment = geometry.segment(hit.segmentId);
    if (!segment) return false;

    const line = segment.asLine();
    if (!line) return false;

    ctx.editor.upgradeLineToCubic(line);
    return true;
  }
}
