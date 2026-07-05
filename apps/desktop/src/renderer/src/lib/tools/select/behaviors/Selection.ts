import type { ToolContext } from "../../core/Behavior";
import type { ClickEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import type { SelectableId } from "@/types";

export class Selection implements SelectBehavior {
  onClick(state: SelectState, ctx: ToolContext<SelectState>, event: ClickEvent): boolean {
    if (state.type !== "ready" && ctx.editor.selection.hasSelection()) return false;

    const editor = ctx.editor;
    let ids: SelectableId[] | null = null;
    const target = event.target;

    switch (target.kind) {
      case "point": {
        ids = [target.id];
        break;
      }

      case "anchor": {
        ids = [target.id];
        break;
      }

      case "segment": {
        ids = [target.id];
        break;
      }

      case "canvas":
      case "node":
        break;
    }

    if (!ids) {
      if (event.shiftKey || !editor.selection.hasSelection()) return false;

      editor.selection.clear();
      ctx.setState({ type: "ready" });
      return true;
    }

    if (event.shiftKey) {
      const selected = ids.every((id) => editor.selection.has(id));

      for (const id of ids) {
        if (selected) {
          editor.selection.remove(id);
        } else {
          editor.selection.add(id);
        }
      }
    } else {
      editor.selection.select(ids);
    }

    ctx.setState({ type: "ready" });
    return true;
  }
}
