import { Vec2 } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { DragEvent, DragStartEvent, KeyDownEvent } from "../../core/GestureDetector";
import { PenHandlePull } from "../PenHandlePull";
import { PenStroke } from "../PenStroke";
import { PenTargets, type PenTarget } from "../PenTargets";
import type { PenBehavior, PenState } from "../types";
import type { Pen } from "../Pen";

const DRAG_THRESHOLD = 3;

/**
 * Pulls the next segment's first handle out of an open end: the active endpoint, or
 * another contour's end when no stroke is active, which then continues from it.
 */
export class PullHandleBehavior implements PenBehavior {
  #pull: PenHandlePull | null = null;
  #done: (() => void) | null = null;

  onDragStart(state: PenState, ctx: ToolContext<PenState, Pen>, event: DragStartEvent): boolean {
    if (state.type !== "ready") return false;

    const stroke = PenStroke.active(ctx.tool);
    if (!stroke) return false;

    const nodePoint = ctx.editor.getPointInNodeSpace(event.coords.scene, stroke.node.position);
    const target = PenTargets.forGeometry(stroke.layer.geometry).at(
      nodePoint,
      ctx.editor.hitRadius,
    );
    if (!pullsFromTarget(stroke, target)) return false;

    if (!stroke.activeEndpoint) {
      stroke.continueContour(target.contourId, target.side, target.pointId);
    }

    const end = stroke.activeEndpoint;
    if (end?.pointId !== target.pointId) return false;

    const pull = { pointId: end.pointId, position: end.position, handlePosition: null };
    const handlePull = PenHandlePull.begin(stroke, pull);
    this.#pull = handlePull;
    this.#done = ctx.onCancel(() => handlePull.cancel());
    ctx.setState({ type: "pulling", pull, guides: [] });
    return true;
  }

  onDrag(state: PenState, ctx: ToolContext<PenState, Pen>, event: DragEvent): boolean {
    if (state.type !== "pulling") return false;

    const stroke = PenStroke.active(ctx.tool);
    if (!stroke || !this.#pull) return true;

    const pointer = ctx.editor.getPointInNodeSpace(event.coords.scene, stroke.node.position);
    const { pull } = state;
    const withinThreshold = Vec2.dist(pull.position, pointer) <= DRAG_THRESHOLD;
    if (!pull.handlePosition && withinThreshold) return true;

    const guides = this.#pull.preview(pointer, event.shiftKey, event.altKey);
    ctx.setState({
      type: "pulling",
      pull: { ...pull, handlePosition: this.#pull.handlePosition },
      guides,
    });
    return true;
  }

  onDragEnd(state: PenState, ctx: ToolContext<PenState, Pen>): boolean {
    if (state.type !== "pulling") return false;

    this.#pull?.commit();
    this.#finish(ctx);
    return true;
  }

  onDragCancel(state: PenState, ctx: ToolContext<PenState, Pen>): boolean {
    if (state.type !== "pulling") return false;

    this.#pull?.cancel();
    this.#finish(ctx);
    return true;
  }

  onKeyDown(state: PenState, ctx: ToolContext<PenState, Pen>, event: KeyDownEvent): boolean {
    if (state.type !== "pulling" || event.key !== "Escape") return false;

    this.#pull?.cancel();
    this.#finish(ctx);
    return true;
  }

  #finish(ctx: ToolContext<PenState, Pen>): void {
    if (this.#done) this.#done();
    this.#pull = null;
    this.#done = null;
    ctx.setState({ type: "ready" });
  }
}

/** Whether a press on `target` pulls a handle rather than joining or closing contours. */
function pullsFromTarget(
  stroke: PenStroke,
  target: PenTarget,
): target is PenTarget & { readonly type: "terminal" } {
  if (target.type !== "terminal") return false;

  const active = stroke.activeEndpoint;
  return active ? active.pointId === target.pointId : true;
}
