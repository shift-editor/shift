import { Rect, type Rect2D } from "@shift/geo";
import type { PointId } from "@shift/types";
import type { ToolContext } from "../../core/Behavior";
import type { DragEvent, DragStartEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

export class Marquee implements SelectBehavior {
  onDragStart(state: SelectState, ctx: ToolContext<SelectState>, event: DragStartEvent): boolean {
    if (state.type !== "ready") return false;

    if (ctx.editor.selection.hasSelection()) {
      ctx.editor.selection.clear();
    }

    ctx.setState({
      type: "brushing",
      selection: {
        startPos: event.coords.scene,
        currentPos: event.coords.scene,
      },
    });

    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState>, event: DragEvent): boolean {
    if (state.type !== "brushing") return false;

    const rect = Rect.fromPoints(state.selection.startPos, state.selection.currentPos);
    const pointIds = this.getPointsInRect(rect, ctx);
    ctx.editor.selection.select([...pointIds].map((pointId) => ({ kind: "point", pointId })));

    ctx.setState({
      type: "brushing",
      selection: { ...state.selection, currentPos: event.coords.scene },
    });
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "brushing") return false;

    const rect = Rect.fromPoints(state.selection.startPos, state.selection.currentPos);
    const pointIds = this.getPointsInRect(rect, ctx);
    ctx.editor.selection.select([...pointIds].map((pointId) => ({ kind: "point", pointId })));

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
    void rect;
    void ctx;
    return new Set();
  }
}
