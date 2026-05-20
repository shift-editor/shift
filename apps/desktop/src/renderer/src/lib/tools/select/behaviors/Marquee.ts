import { Rect, type Rect2D } from "@shift/geo";
import type { PointId } from "@shift/types";
import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

export class Marquee implements SelectBehavior {
  onDragStart(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"dragStart">,
  ): boolean {
    if (state.type !== "ready") return false;

    const localPoint = event.coords.glyphLocal;
    if (ctx.editor.selection.hasSelection()) {
      ctx.editor.selection.clear();
    }

    ctx.setState({
      type: "brushing",
      selection: { startPos: localPoint, currentPos: localPoint },
    });

    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState>, event: ToolEventOf<"drag">): boolean {
    if (state.type !== "brushing") return false;
    const localPoint = event.coords.glyphLocal;

    const rect = Rect.fromPoints(state.selection.startPos, state.selection.currentPos);
    const pointIds = this.getPointsInRect(rect, ctx);
    ctx.editor.selection.select([...pointIds].map((id) => ({ kind: "point", id })));

    ctx.setState({
      type: "brushing",
      selection: { ...state.selection, currentPos: localPoint },
    });
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "brushing") return false;

    const rect = Rect.fromPoints(state.selection.startPos, state.selection.currentPos);
    const pointIds = this.getPointsInRect(rect, ctx);
    ctx.editor.selection.select([...pointIds].map((id) => ({ kind: "point", id })));

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "brushing") return false;

    ctx.editor.selection.clear();
    ctx.setState({ type: "ready" });

    return true;
  }

  private getPointsInRect(rect: Rect2D, ctx: ToolContext<SelectState>): Set<PointId> {
    const instance = ctx.editor.glyphInstance;
    if (!instance) return new Set();

    const hitPoints = instance.geometry.allPoints.filter((p) => Rect.containsPoint(rect, p));
    return new Set(hitPoints.map((p) => p.id));
  }
}
