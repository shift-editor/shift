import type { ToolContext } from "../../core/Behavior";
import type { PointerMoveEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

export class SelectHover implements SelectBehavior {
  onPointerMove(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: PointerMoveEvent,
  ): boolean {
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
        // A box (frame or text box) shows its outline under the pointer.
        if (ctx.editor.nodeDefinition(target.node.kind).selectable) {
          ctx.editor.hover.set(target.node.id);
          return true;
        }
        ctx.editor.hover.clear();
        return false;
      }

      case "text": {
        ctx.editor.hover.set(target.itemId);
        return true;
      }

      case "point": {
        ctx.editor.hover.set(target.id);
        return true;
      }

      case "anchor": {
        ctx.editor.hover.set(target.id);
        return true;
      }

      case "segment":
      case "component": {
        ctx.editor.hover.set(target.id);
        return true;
      }
    }
  }
}
