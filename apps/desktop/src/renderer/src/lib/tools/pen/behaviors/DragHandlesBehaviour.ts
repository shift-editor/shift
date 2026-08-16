import { Vec2 } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { DragEvent, KeyDownEvent } from "../../core/GestureDetector";
import type { PenState, PenBehavior } from "../types";
import type { Pen } from "../Pen";
import { PenStroke } from "../PenStroke";

const DRAG_THRESHOLD = 3;

export class HandleBehavior implements PenBehavior {
  onDrag(state: PenState, ctx: ToolContext<PenState, Pen>, event: DragEvent): boolean {
    switch (state.type) {
      case "anchored": {
        const next = this.#nextAnchoredState(state, event, ctx.tool);
        if (next) ctx.setState(next);
        return true;
      }
      case "dragging":
        ctx.setState(this.#nextDraggingState(state, event, ctx.tool));
        return true;
      default:
        return false;
    }
  }

  onDragEnd(state: PenState, ctx: ToolContext<PenState, Pen>): boolean {
    if (state.type !== "anchored" && state.type !== "dragging") return false;

    const stroke = PenStroke.active(ctx.tool);
    if (!stroke) return false;

    switch (state.type) {
      case "anchored":
        stroke.commitAnchor(state.anchorPosition);
        break;
      case "dragging":
        stroke.appendCurve(state.curve);
        break;
    }

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: PenState, ctx: ToolContext<PenState, Pen>): boolean {
    if (state.type !== "anchored" && state.type !== "dragging") return false;

    ctx.setState({ type: "ready" });
    return true;
  }

  onKeyDown(state: PenState, ctx: ToolContext<PenState, Pen>, event: KeyDownEvent): boolean {
    if (event.key !== "Escape") return false;
    if (state.type !== "anchored" && state.type !== "dragging") return false;

    ctx.setState({ type: "ready" });
    return true;
  }

  #nextAnchoredState(
    state: PenState & { type: "anchored" },
    event: DragEvent,
    pen: Pen,
  ): (PenState & { type: "dragging" }) | null {
    const stroke = PenStroke.active(pen);
    const start = stroke?.activeEndpoint;
    if (!stroke || !start) return null;

    const handlePosition = pen.editor.getPointInNodeSpace(event.coords.scene, stroke.node.position);
    if (Vec2.dist(state.anchorPosition, handlePosition) <= DRAG_THRESHOLD) return null;

    return {
      type: "dragging",
      curve: {
        start,
        anchorPosition: state.anchorPosition,
        handlePosition,
      },
    };
  }

  #nextDraggingState(
    state: PenState & { type: "dragging" },
    event: DragEvent,
    pen: Pen,
  ): PenState & { type: "dragging" } {
    const stroke = PenStroke.active(pen);
    if (!stroke) return state;

    const handlePosition = pen.editor.getPointInNodeSpace(event.coords.scene, stroke.node.position);
    return {
      ...state,
      curve: { ...state.curve, handlePosition },
    };
  }
}
