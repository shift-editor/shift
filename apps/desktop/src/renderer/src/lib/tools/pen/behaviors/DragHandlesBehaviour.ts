import { Vec2 } from "@shift/geo";
import type { PointId } from "@shift/types";
import { DirectionSnap, PositionReference, type MoveEdit } from "@/lib/model/positions";
import type { ToolContext } from "../../core/Behavior";
import type { DragEvent, KeyDownEvent, ToolEvent } from "../../core/GestureDetector";
import type { PenCurve, PenState, PenBehavior } from "../types";
import type { Pen } from "../Pen";
import { PenStroke } from "../PenStroke";

const DRAG_THRESHOLD = 3;

export class HandleBehavior implements PenBehavior {
  #move: MoveEdit | null = null;
  #done: (() => void) | null = null;
  #endpointId: PointId | null = null;

  onDrag(state: PenState, ctx: ToolContext<PenState, Pen>, event: DragEvent): boolean {
    switch (state.type) {
      case "anchored": {
        const next = this.#nextAnchoredState(state, event, ctx.tool);
        if (next) {
          const move = this.#move;
          if (!move) throw new Error("cannot guard Pen curve without an active move");

          this.#done = ctx.onCancel(() => move.discard());
          ctx.setState(next);
        }
        return true;
      }
      case "dragging":
        ctx.setState(this.#nextDraggingState(state, event, ctx.tool));
        return true;
      default:
        return false;
    }
  }

  onStateEnter(
    _prev: PenState,
    next: PenState,
    ctx: ToolContext<PenState, Pen>,
    event: ToolEvent,
  ): void {
    if (next.type !== "dragging" || event.type !== "drag") return;

    ctx.setState(this.#setCurvePositions(next));
  }

  onDragEnd(state: PenState, ctx: ToolContext<PenState, Pen>): boolean {
    if (state.type !== "anchored" && state.type !== "dragging") return false;

    const stroke = PenStroke.active(ctx.tool);
    if (!stroke) {
      this.#cancelCurve();
      return false;
    }

    switch (state.type) {
      case "anchored":
        stroke.commitAnchor(state.anchorPosition);
        break;
      case "dragging":
        this.#finishCurve(stroke, state.curve);
        break;
    }

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: PenState, ctx: ToolContext<PenState, Pen>): boolean {
    if (state.type !== "anchored" && state.type !== "dragging") return false;

    this.#clearCurve();
    ctx.setState({ type: "ready" });
    return true;
  }

  onKeyDown(state: PenState, ctx: ToolContext<PenState, Pen>, event: KeyDownEvent): boolean {
    if (event.key !== "Escape") return false;
    if (state.type !== "anchored" && state.type !== "dragging") return false;

    this.#cancelCurve();
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

    const curve = {
      start,
      anchorPosition: state.anchorPosition,
      handlePosition,
    };
    const [edit, , controlEndId, endpointId] = stroke.beginCurve({
      ...curve,
      handlePosition: curve.anchorPosition,
    });

    try {
      this.#move = stroke.layer.positions
        .within(edit)
        .move({ points: [controlEndId] })
        .from(PositionReference.point(controlEndId))
        .directionSnappedBy(
          DirectionSnap.everyDegrees(15, {
            when: () => {
              const state = pen.getState();
              return state.type === "dragging" && state.shiftKey;
            },
          }).around(PositionReference.point(endpointId)),
        );
    } catch (error) {
      edit.cancel();
      throw error;
    }

    this.#endpointId = endpointId;
    return { type: "dragging", curve, shiftKey: event.shiftKey, guides: [] };
  }

  #nextDraggingState(
    state: PenState & { type: "dragging" },
    event: DragEvent,
    pen: Pen,
  ): PenState & { type: "dragging" } {
    const stroke = PenStroke.active(pen);
    if (!stroke) return state;

    const handlePosition = pen.editor.getPointInNodeSpace(event.coords.scene, stroke.node.position);
    const curve = { ...state.curve, handlePosition };

    return { ...state, curve, shiftKey: event.shiftKey };
  }

  #setCurvePositions(state: PenState & { type: "dragging" }): PenState & { type: "dragging" } {
    if (!this.#move) throw new Error("cannot update Pen curve without an active move");

    const { curve } = state;
    const feedback = this.#move.preview(Vec2.sub(curve.anchorPosition, curve.handlePosition));
    const handlePosition = Vec2.sub(curve.anchorPosition, feedback.delta);
    const guides = feedback.guides.map((guide) => {
      if (guide.kind !== "direction") return guide;

      return { ...guide, to: handlePosition };
    });

    return {
      ...state,
      curve: { ...curve, handlePosition },
      guides,
    };
  }

  #finishCurve(stroke: PenStroke, curve: PenCurve): void {
    if (!this.#move || !this.#endpointId) {
      throw new Error("cannot finish Pen curve without an active move");
    }

    stroke.finishCurve(curve, this.#move, this.#endpointId);
    if (this.#done) this.#done();
    this.#clearCurve();
  }

  #cancelCurve(): void {
    this.#move?.discard();
    if (this.#done) this.#done();
    this.#clearCurve();
  }

  #clearCurve(): void {
    this.#move = null;
    this.#done = null;
    this.#endpointId = null;
  }
}
