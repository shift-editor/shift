import type { Point2D } from "@shift/types";
import { Vec2 } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { EditorAPI } from "../../core/EditorAPI";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { PenState, PenBehavior, AnchorData } from "../types";
import type { DragSnapSession } from "@/lib/editor/snapping/types";

const DRAG_THRESHOLD = 3;

export class HandleBehavior implements PenBehavior {
  #snap: DragSnapSession | null = null;

  onDrag(state: PenState, ctx: ToolContext<PenState>, event: ToolEventOf<"drag">): boolean {
    if (state.type === "anchored") {
      const next = this.nextAnchoredState(state, event, ctx.editor);
      if (next) ctx.setState(next);
      return true;
    }

    if (state.type === "dragging") {
      ctx.setState(this.nextDraggingState(state, event, ctx.editor));
      return true;
    }
    return false;
  }

  onDragEnd(state: PenState, ctx: ToolContext<PenState>, event: ToolEventOf<"dragEnd">): boolean {
    if (state.type !== "anchored" && state.type !== "dragging") return false;
    ctx.setState({
      type: "ready",
      mousePos: event.coords.glyphLocal,
    });
    return true;
  }

  onDragCancel(state: PenState, ctx: ToolContext<PenState>): boolean {
    if (state.type === "anchored") {
      // cancelPenGesture(ctx.editor);
      ctx.setState({
        type: "ready",
        mousePos: state.anchor.position,
      });
      return true;
    }
    if (state.type === "dragging") {
      // cancelPenGesture(ctx.editor);
      ctx.setState({
        type: "ready",
        mousePos: state.anchor.position,
      });
      return true;
    }
    return false;
  }

  onKeyDown(state: PenState, ctx: ToolContext<PenState>, event: ToolEventOf<"keyDown">): boolean {
    if (event.key !== "Escape") return false;
    if (state.type !== "anchored" && state.type !== "dragging") return false;
    // cancelPenGesture(ctx.editor);
    ctx.setState({
      type: "ready",
      mousePos: state.anchor.position,
    });
    return true;
  }

  onStateEnter(prev: PenState, next: PenState, ctx: ToolContext<PenState>): void {
    const editor = ctx.editor;
    if ((prev.type === "anchored" || prev.type === "dragging") && next.type === "ready") {
      // commitPenGesture(editor, "Add Point");
      this.clearSnap();
      editor.setSnapIndicator(null);
    }
  }

  private nextAnchoredState(
    state: PenState & { type: "anchored" },
    event: ToolEventOf<"drag">,
    editor: EditorAPI,
  ): (PenState & { type: "dragging" }) | null {
    const localPoint = event.coords.glyphLocal;
    const dist = Vec2.dist(state.anchor.position, localPoint);
    if (dist <= DRAG_THRESHOLD) return null;

    this.startSnap(editor, state.anchor);
    let snappedPos: Point2D = localPoint;
    if (this.#snap) {
      const result = this.#snap.snap(localPoint, { shiftKey: event.shiftKey });
      snappedPos = result.point;
      editor.setSnapIndicator(result.indicator);
    }

    // const handles = createPenHandles(editor, state.anchor, snappedPos);
    const optionalSnappedPos = event.shiftKey ? { snappedPos } : {};
    return {
      type: "dragging",
      anchor: state.anchor,
      handles: {},
      mousePos: localPoint,
      ...optionalSnappedPos,
    };
  }

  private nextDraggingState(
    state: PenState & { type: "dragging" },
    event: ToolEventOf<"drag">,
    editor: EditorAPI,
  ): PenState & { type: "dragging" } {
    const localPoint = event.coords.glyphLocal;
    let snappedPos: Point2D = localPoint;

    if (this.#snap) {
      const result = this.#snap.snap(localPoint, { shiftKey: event.shiftKey });
      snappedPos = result.point;
      editor.setSnapIndicator(result.indicator);
    }

    // updatePenHandles(editor, state.anchor, state.handles, snappedPos);
    const optionalSnappedPos = event.shiftKey ? { snappedPos } : {};
    return {
      ...state,
      mousePos: localPoint,
      ...optionalSnappedPos,
    };
  }

  private startSnap(editor: EditorAPI, anchor: AnchorData): void {
    this.clearSnap();

    this.#snap = editor.createDragSnapSession({
      anchorPointId: anchor.pointId,
      dragStart: anchor.position,
      excludedPointIds: [],
    });
  }

  private clearSnap(): void {
    if (this.#snap) this.#snap.clear();
    this.#snap = null;
  }
}
