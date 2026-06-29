import type { SelectionEntry } from "@/lib/editor/Selection";
import type { ToolContext } from "../../core/Behavior";
import type { ClickEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

export class Selection implements SelectBehavior {
  onClick(state: SelectState, ctx: ToolContext<SelectState>, event: ClickEvent): boolean {
    if (state.type !== "ready" && ctx.editor.selection.hasSelection()) return false;

    const editor = ctx.editor;
    let items: SelectionEntry[] | null = null;
    const target = event.target;

    switch (target.kind) {
      case "point": {
        items = [{ kind: "point", pointId: target.id }];
        break;
      }

      case "anchor": {
        items = [{ kind: "anchor", anchorId: target.id }];
        break;
      }

      case "segment": {
        const pointIds = target.pointIds;
        const segmentPointSelection = pointIds.map((pointId) => ({
          kind: "point" as const,
          pointId,
        }));

        items = [{ kind: "segment", segmentId: target.id }, ...segmentPointSelection];
        break;
      }

      case "canvas":
      case "node":
        break;
    }

    if (!items) {
      if (event.shiftKey || !editor.selection.hasSelection()) return false;

      editor.selection.clear();
      ctx.setState({ type: "ready" });
      return true;
    }

    if (event.shiftKey) {
      const selected = items.every((item) => editor.selection.isSelected(item));

      for (const item of items) {
        if (selected) {
          editor.selection.remove(item);
        } else {
          editor.selection.add(item);
        }
      }
    } else {
      editor.selection.select(items);
    }

    ctx.setState({ type: "ready" });
    return true;
  }
}
