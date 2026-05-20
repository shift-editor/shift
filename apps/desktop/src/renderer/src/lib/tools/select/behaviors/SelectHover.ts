import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

export class SelectHover implements SelectBehavior {
  onPointerMove(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"pointerMove">,
  ): boolean {
    if (state.type === "idle") return false;

    if (
      state.type === "brushing" ||
      state.type === "translating" ||
      state.type === "resizing" ||
      state.type === "rotating" ||
      state.type === "bending"
    ) {
      ctx.editor.hover.clear();
      return false;
    }

    const instance = ctx.editor.glyphInstance;
    if (!instance) {
      ctx.editor.hover.clear();
      return false;
    }

    const geometry = instance.geometry;

    const pos = event.coords.glyphLocal;
    const radius = ctx.editor.hitRadius;

    const anchorHit = geometry.hitAnchor(pos, radius);
    if (anchorHit) {
      ctx.editor.hover.set({ type: "anchor", anchorId: anchorHit.anchorId });
      return false;
    }

    const pointHit = geometry.hitPoint(pos, radius);
    if (pointHit) {
      ctx.editor.hover.set({ type: "point", pointId: pointHit.pointId });
      return false;
    }

    const segmentHit = geometry.hitSegment(pos, radius);
    if (segmentHit) {
      ctx.editor.hover.set({
        type: "segment",
        segmentId: segmentHit.segmentId,
      });
      return false;
    }

    ctx.editor.hover.clear();
    return false;
  }
}
