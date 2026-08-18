import { Vec2 } from "@shift/geo";
import type { PointId } from "@shift/types";
import type { GlyphLayerEdit } from "@/lib/model/GlyphLayerEdit";
import type { ToolContext } from "../../core/Behavior";
import type { DragEvent, KeyDownEvent } from "../../core/GestureDetector";
import type { PenCurve, PenState, PenBehavior } from "../types";
import type { Pen } from "../Pen";
import { PenStroke } from "../PenStroke";

const DRAG_THRESHOLD = 3;

export class HandleBehavior implements PenBehavior {
  #edit: GlyphLayerEdit | null = null;
  #done: (() => void) | null = null;
  #controlStartId: PointId | null = null;
  #controlEndId: PointId | null = null;
  #endpointId: PointId | null = null;

  onDrag(state: PenState, ctx: ToolContext<PenState, Pen>, event: DragEvent): boolean {
    switch (state.type) {
      case "anchored": {
        const next = this.#nextAnchoredState(state, event, ctx.tool);
        if (next) {
          const edit = this.#edit;
          if (!edit) throw new Error("cannot guard Pen curve without an active edit");

          this.#done = ctx.onCancel(() => edit.cancel());
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
    const [edit, controlStartId, controlEndId, endpointId] = stroke.beginCurve(curve);
    this.#edit = edit;
    this.#controlStartId = controlStartId;
    this.#controlEndId = controlEndId;
    this.#endpointId = endpointId;

    return { type: "dragging", curve };
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
    this.#setCurvePositions(pen, curve);

    return { ...state, curve };
  }

  #setCurvePositions(pen: Pen, curve: PenCurve): void {
    if (!this.#edit || !this.#controlStartId || !this.#controlEndId || !this.#endpointId) {
      throw new Error("cannot update Pen curve without an active glyph layer edit");
    }

    const geometry = pen.resolveCurve(curve);
    this.#edit.setPositions([
      { kind: "point", id: this.#controlStartId, x: geometry.c0.x, y: geometry.c0.y },
      { kind: "point", id: this.#controlEndId, x: geometry.c1.x, y: geometry.c1.y },
      { kind: "point", id: this.#endpointId, x: geometry.p1.x, y: geometry.p1.y },
    ]);
  }

  #finishCurve(stroke: PenStroke, curve: PenCurve): void {
    if (!this.#edit || !this.#endpointId) {
      throw new Error("cannot finish Pen curve without an active glyph layer edit");
    }

    stroke.finishCurve(curve, this.#edit, this.#endpointId);
    if (this.#done) this.#done();
    this.#clearCurve();
  }

  #cancelCurve(): void {
    this.#edit?.cancel();
    if (this.#done) this.#done();
    this.#clearCurve();
  }

  #clearCurve(): void {
    this.#edit = null;
    this.#done = null;
    this.#controlStartId = null;
    this.#controlEndId = null;
    this.#endpointId = null;
  }
}
