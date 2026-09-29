import { Vec2 } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { DragEvent, KeyDownEvent } from "../../core/GestureDetector";
import { PenCloseCurve } from "../PenCloseCurve";
import { PenStroke } from "../PenStroke";
import type { PenBehavior, PenState } from "../types";
import type { Pen } from "../Pen";

const DRAG_THRESHOLD = 3;

/** Closes the active contour from a press on its first point, shaping the closing curve on drag. */
export class CloseBehavior implements PenBehavior {
  #curve: PenCloseCurve | null = null;
  #done: (() => void) | null = null;

  onDrag(state: PenState, ctx: ToolContext<PenState, Pen>, event: DragEvent): boolean {
    if (state.type !== "closing") return false;

    const stroke = PenStroke.active(ctx.tool);
    if (!stroke) return true;

    const pointer = ctx.editor.getPointInNodeSpace(event.coords.scene, stroke.node.position);
    const { close } = state;
    const withinThreshold = Vec2.dist(close.firstPosition, pointer) <= DRAG_THRESHOLD;
    if (!close.handlePosition && withinThreshold) return true;

    if (!this.#curve) {
      const curve = PenCloseCurve.begin(stroke, close);
      this.#curve = curve;
      this.#done = ctx.onCancel(() => curve.cancel());
    }

    const guides = this.#curve.preview(pointer, event.shiftKey);
    ctx.setState({
      type: "closing",
      close: { ...close, handlePosition: pointer },
      shiftKey: event.shiftKey,
      guides,
    });
    return true;
  }

  onDragEnd(state: PenState, ctx: ToolContext<PenState, Pen>): boolean {
    if (state.type !== "closing") return false;

    if (this.#curve) {
      this.#curve.commit();
      ctx.tool.clearActiveContour();
    } else {
      PenStroke.active(ctx.tool)?.closeActiveContour();
    }

    this.#finish(ctx);
    return true;
  }

  onDragCancel(state: PenState, ctx: ToolContext<PenState, Pen>): boolean {
    if (state.type !== "closing") return false;

    this.#curve = null;
    this.#finish(ctx);
    return true;
  }

  onKeyDown(state: PenState, ctx: ToolContext<PenState, Pen>, event: KeyDownEvent): boolean {
    if (state.type !== "closing" || event.key !== "Escape") return false;

    this.#curve?.cancel();
    this.#finish(ctx);
    return true;
  }

  #finish(ctx: ToolContext<PenState, Pen>): void {
    if (this.#done) this.#done();
    this.#curve = null;
    this.#done = null;
    ctx.setState({ type: "ready" });
  }
}
