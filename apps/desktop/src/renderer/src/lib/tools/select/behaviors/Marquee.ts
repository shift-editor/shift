import type { PointId, Rect2D } from "@shift/types";
import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import { normalizeRect, pointInRect } from "../utils";

export class Marquee implements SelectBehavior {
  onDragStart(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"dragStart">,
  ): boolean {
    if (state.type !== "ready" && state.type !== "selected") return false;

    const hit = ctx.editor.hitTest(event.coords);
    if (hit !== null) return false;

    const localPoint = event.coords.glyphLocal;
    if (state.type === "selected") {
      ctx.editor.selection.clear();
    }
    ctx.editor.selection.setMode("preview");
    ctx.setState({
      type: "selecting",
      selection: { startPos: localPoint, currentPos: localPoint },
    });

    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState>, event: ToolEventOf<"drag">): boolean {
    if (state.type !== "selecting") return false;
    const localPoint = event.coords.glyphLocal;

    ctx.setState({
      type: "selecting",
      selection: { ...state.selection, currentPos: localPoint },
    });
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "selecting") return false;

    const rect = normalizeRect(state.selection.startPos, state.selection.currentPos);
    const pointIds = this.getPointsInRect(rect, ctx);
    ctx.editor.selection.select([...pointIds].map((id) => ({ kind: "point", id })));
    ctx.setState(pointIds.size > 0 ? { type: "selected" } : { type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "selecting") return false;
    ctx.editor.selection.clear();
    ctx.setState({ type: "ready" });
    return true;
  }

  onStateEnter(prev: SelectState, next: SelectState, ctx: ToolContext<SelectState>): void {
    const editor = ctx.editor;
    if (next.type === "selecting") {
      const rect = normalizeRect(next.selection.startPos, next.selection.currentPos);
      editor.setMarqueePreviewRect(rect);
    } else if (prev.type === "selecting") {
      editor.setMarqueePreviewRect(null);
    }
    if (prev.type === "selecting" && (next.type === "selected" || next.type === "ready")) {
      editor.selection.setMode("committed");
    }
  }

  private getPointsInRect(rect: Rect2D, ctx: ToolContext<SelectState>): Set<PointId> {
    const allPoints = ctx.editor.getAllPoints();
    const hitPoints = allPoints.filter((p) => pointInRect(p, rect));
    return new Set(hitPoints.map((p) => p.id));
  }
}
