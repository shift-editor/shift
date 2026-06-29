import type { ToolContext } from "../../core/Behavior";
import type { PointerMoveEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

export class SelectHover implements SelectBehavior {
  onPointerMove(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: PointerMoveEvent,
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

    const target = event.target;
    switch (target.kind) {
      case "canvas": {
        ctx.editor.hover.clear();
        return false;
      }

      case "node": {
        ctx.editor.hover.clear();
        return false;
      }

      case "point": {
        ctx.editor.hover.set({ kind: "point", pointId: target.id });
        return true;
      }

      case "anchor": {
        ctx.editor.hover.set({ kind: "anchor", anchorId: target.id });
        return true;
      }

      case "segment": {
        ctx.editor.hover.set({ kind: "segment", segmentId: target.id });
        return true;
      }
    }

    ctx.editor.hover.clear();
    return false;
  }
}
