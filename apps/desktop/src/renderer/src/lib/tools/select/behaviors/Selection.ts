import type { Selectable } from "@/lib/editor/Selection";
import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

export class Selection implements SelectBehavior {
  onClick(state: SelectState, ctx: ToolContext<SelectState>, event: ToolEventOf<"click">): boolean {
    if (state.type !== "ready" && ctx.editor.selection.hasSelection()) return false;

    const editor = ctx.editor;
    const instance = editor.previewGlyphInstance;
    if (!instance) return false;

    const geometry = instance.geometry;
    const pos = event.coords.glyphLocal;
    const radius = editor.hitRadius;
    let items: Selectable[] | null = null;

    const anchorHit = geometry.hitAnchor(pos, radius);
    if (anchorHit) {
      items = [{ kind: "anchor", id: anchorHit.anchorId }];
    }

    if (!items) {
      const pointHit = geometry.hitPoint(pos, radius);
      if (pointHit) {
        items = [{ kind: "point", id: pointHit.pointId }];
      }
    }

    if (!items) {
      const segmentHit = geometry.hitSegment(pos, radius);
      const segment = segmentHit ? geometry.segment(segmentHit.segmentId) : null;

      if (segmentHit && segment) {
        items = [
          { kind: "segment", id: segmentHit.segmentId },
          ...segment.pointIds.map((id) => ({ kind: "point" as const, id })),
        ];
      }
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
