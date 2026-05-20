import type { Point2D } from "@shift/geo";
import { Vec2 } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { Editor } from "@/lib/editor/Editor";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { PenState, PenBehavior, Anchor, Handles } from "../types";
import { PenStroke } from "../PenStroke";

const DRAG_THRESHOLD = 3;

export class HandleBehavior implements PenBehavior {
  onDrag(state: PenState, ctx: ToolContext<PenState>, event: ToolEventOf<"drag">): boolean {
    if (state.type === "anchored") {
      const next = this.#nextAnchoredState(state, event, ctx.editor);
      if (next) ctx.setState(next);
      return true;
    }

    if (state.type === "dragging") {
      ctx.setState(this.#nextDraggingState(state, event, ctx.editor));
      return true;
    }

    return false;
  }

  onDragEnd(state: PenState, ctx: ToolContext<PenState>): boolean {
    if (state.type !== "anchored" && state.type !== "dragging") return false;

    if (state.type === "anchored" && !state.anchor.pointId) {
      PenStroke.active(ctx.editor)?.commitAnchor(state.anchor);
    }

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: PenState, ctx: ToolContext<PenState>): boolean {
    if (state.type !== "anchored" && state.type !== "dragging") return false;

    ctx.setState({ type: "ready" });
    return true;
  }

  onKeyDown(state: PenState, ctx: ToolContext<PenState>, event: ToolEventOf<"keyDown">): boolean {
    if (event.key !== "Escape") return false;
    if (state.type !== "anchored" && state.type !== "dragging") return false;

    ctx.setState({ type: "ready" });
    return true;
  }

  #nextAnchoredState(
    state: PenState & { type: "anchored" },
    event: ToolEventOf<"drag">,
    editor: Editor,
  ): (PenState & { type: "dragging" }) | null {
    const localPoint = event.coords.glyphLocal;
    if (Vec2.dist(state.anchor.position, localPoint) <= DRAG_THRESHOLD) return null;

    const handles = this.#createHandles(state.anchor, localPoint, editor);

    return {
      type: "dragging",
      anchor: state.anchor,
      handles,
      mousePos: localPoint,
    };
  }

  #nextDraggingState(
    state: PenState & { type: "dragging" },
    event: ToolEventOf<"drag">,
    editor: Editor,
  ): PenState & { type: "dragging" } {
    const localPoint = event.coords.glyphLocal;

    this.#updateHandles(state.anchor, state.handles, localPoint, editor);

    return {
      ...state,
      mousePos: localPoint,
    };
  }

  #createHandles(anchor: Anchor, handlePos: Point2D, editor: Editor): Handles {
    return PenStroke.active(editor)?.createHandles(anchor, handlePos) ?? {};
  }

  #updateHandles(anchor: Anchor, handles: Handles, handlePos: Point2D, editor: Editor): void {
    PenStroke.active(editor)?.moveHandles(anchor, handles, handlePos);
  }
}
