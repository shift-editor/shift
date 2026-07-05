import type { Point2D } from "@shift/geo";
import { Vec2 } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { DragEvent, KeyDownEvent } from "../../core/GestureDetector";
import type { PenState, PenBehavior, Anchor, Handles } from "../types";
import type { Pen } from "../Pen";
import { PenStroke } from "../PenStroke";

const DRAG_THRESHOLD = 3;

export class HandleBehavior implements PenBehavior {
  onDrag(state: PenState, ctx: ToolContext<PenState, Pen>, event: DragEvent): boolean {
    if (state.type === "anchored") {
      const next = this.#nextAnchoredState(state, event, ctx.tool);
      if (next) ctx.setState(next);
      return true;
    }

    if (state.type === "dragging") {
      ctx.setState(this.#nextDraggingState(state, event, ctx.tool));
      return true;
    }

    return false;
  }

  onDragEnd(state: PenState, ctx: ToolContext<PenState, Pen>): boolean {
    if (state.type !== "anchored" && state.type !== "dragging") return false;

    if (state.type === "anchored" && !state.anchor.pointId) {
      PenStroke.active(ctx.tool)?.commitAnchor(state.anchor);
    }

    if (state.type === "dragging") {
      PenStroke.active(ctx.tool)?.commitHandles();
    }

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: PenState, ctx: ToolContext<PenState, Pen>): boolean {
    if (state.type !== "anchored" && state.type !== "dragging") return false;

    // Matches prior observable behavior: handle moves were durable per
    // move, so cancel never reverted them. True revert-on-escape can come
    // with the overlay rework.
    if (state.type === "dragging") {
      PenStroke.active(ctx.tool)?.commitHandles();
    }

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
    if (!stroke) return null;

    const localPoint = pen.editor.getPointInNodeSpace(event.coords.scene, stroke.node.position);
    if (Vec2.dist(state.anchor.position, localPoint) <= DRAG_THRESHOLD) return null;

    const handles = this.#createHandles(state.anchor, localPoint, stroke);

    return {
      type: "dragging",
      anchor: state.anchor,
      handles,
      mousePos: localPoint,
    };
  }

  #nextDraggingState(
    state: PenState & { type: "dragging" },
    event: DragEvent,
    pen: Pen,
  ): PenState & { type: "dragging" } {
    const stroke = PenStroke.active(pen);
    if (!stroke) return state;

    const localPoint = pen.editor.getPointInNodeSpace(event.coords.scene, stroke.node.position);

    this.#updateHandles(state.anchor, state.handles, localPoint, stroke);

    return {
      ...state,
      mousePos: localPoint,
    };
  }

  #createHandles(anchor: Anchor, handlePos: Point2D, stroke: PenStroke): Handles {
    return stroke.createHandles(anchor, handlePos);
  }

  #updateHandles(anchor: Anchor, handles: Handles, handlePos: Point2D, stroke: PenStroke): void {
    stroke.moveHandles(anchor, handles, handlePos);
  }
}
