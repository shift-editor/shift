import type { Point2D } from "@shift/types";
import { Vec2 } from "@shift/geo";
import { Contours } from "@shift/font";
import { Validate } from "@shift/validation";
import type { ToolContext } from "../../core/Behavior";
import type { EditorAPI } from "../../core/EditorAPI";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { PenState, PenBehavior, AnchorData, HandleData } from "../types";
import { AddPointCommand, InsertPointCommand } from "@/lib/commands";
import type { DragSnapSession } from "@/lib/editor/snapping/types";

const DRAG_THRESHOLD = 3;

export class HandleBehavior implements PenBehavior {
  #snap: DragSnapSession | null = null;

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

  onDragEnd(state: PenState, ctx: ToolContext<PenState>, event: ToolEventOf<"dragEnd">): boolean {
    if (state.type !== "anchored" && state.type !== "dragging") return false;

    ctx.setState({ type: "ready", mousePos: event.coords.glyphLocal });
    return true;
  }

  onDragCancel(state: PenState, ctx: ToolContext<PenState>): boolean {
    if (state.type !== "anchored" && state.type !== "dragging") return false;

    ctx.setState({ type: "ready", mousePos: state.anchor.position });
    return true;
  }

  onKeyDown(state: PenState, ctx: ToolContext<PenState>, event: ToolEventOf<"keyDown">): boolean {
    if (event.key !== "Escape") return false;
    if (state.type !== "anchored" && state.type !== "dragging") return false;

    ctx.setState({ type: "ready", mousePos: state.anchor.position });
    return true;
  }

  onStateEnter(prev: PenState, next: PenState, ctx: ToolContext<PenState>): void {
    if ((prev.type === "anchored" || prev.type === "dragging") && next.type === "ready") {
      this.#clearSnap();
      ctx.editor.setSnapIndicator(null);
    }
  }

  #nextAnchoredState(
    state: PenState & { type: "anchored" },
    event: ToolEventOf<"drag">,
    editor: EditorAPI,
  ): (PenState & { type: "dragging" }) | null {
    const localPoint = event.coords.glyphLocal;
    if (Vec2.dist(state.anchor.position, localPoint) <= DRAG_THRESHOLD) return null;

    this.#startSnap(editor, state.anchor);

    let snappedPos = localPoint;
    if (this.#snap) {
      const result = this.#snap.snap(localPoint, { shiftKey: event.shiftKey });
      snappedPos = result.point;
      editor.setSnapIndicator(result.indicator);
    }

    const handles = this.#createHandles(state.anchor, snappedPos, editor);

    return {
      type: "dragging",
      anchor: state.anchor,
      handles,
      mousePos: localPoint,
      ...(event.shiftKey ? { snappedPos } : {}),
    };
  }

  #nextDraggingState(
    state: PenState & { type: "dragging" },
    event: ToolEventOf<"drag">,
    editor: EditorAPI,
  ): PenState & { type: "dragging" } {
    const localPoint = event.coords.glyphLocal;

    let snappedPos = localPoint;
    if (this.#snap) {
      const result = this.#snap.snap(localPoint, { shiftKey: event.shiftKey });
      snappedPos = result.point;
      editor.setSnapIndicator(result.indicator);
    }

    this.#updateHandles(state.anchor, state.handles, snappedPos, editor);

    return {
      ...state,
      mousePos: localPoint,
      ...(event.shiftKey ? { snappedPos } : {}),
    };
  }

  #createHandles(anchor: AnchorData, snappedPos: Point2D, editor: EditorAPI): HandleData {
    const { pointId, position } = anchor;
    const contour = editor.getActiveContour();
    const history = editor.commands;

    const isFirstPoint = !contour || Contours.isEmpty(contour) || contour.points.length <= 1;

    if (isFirstPoint) {
      const cpOutId = history.execute(
        new AddPointCommand(snappedPos.x, snappedPos.y, "offCurve", false),
      );
      return { cpOut: cpOutId };
    }

    const lastPoint = Contours.lastOnCurvePoint(contour!);
    const prevPoint = contour!.points[contour!.points.length - 2];
    const prevIsOffCurve = prevPoint && Validate.isOffCurve(prevPoint);

    if (prevIsOffCurve) {
      const cpInPos = Vec2.mirror(snappedPos, position);
      const cpInId = history.execute(
        new InsertPointCommand(pointId, cpInPos.x, cpInPos.y, "offCurve", false),
      );
      const cpOutId = history.execute(
        new AddPointCommand(snappedPos.x, snappedPos.y, "offCurve", false),
      );
      return { cpIn: cpInId, cpOut: cpOutId };
    }

    if (lastPoint) {
      const cp1Pos = Vec2.lerp(lastPoint, position, 1 / 3);
      history.execute(new InsertPointCommand(pointId, cp1Pos.x, cp1Pos.y, "offCurve", false));
    }

    const cpInPos = Vec2.mirror(snappedPos, position);
    const cpInId = history.execute(
      new InsertPointCommand(pointId, cpInPos.x, cpInPos.y, "offCurve", false),
    );
    return { cpIn: cpInId };
  }

  #updateHandles(anchor: AnchorData, handles: HandleData, snappedPos: Point2D, editor: EditorAPI): void {
    if (handles.cpOut) {
      editor.movePointTo(handles.cpOut, snappedPos);
    }

    if (handles.cpIn) {
      editor.movePointTo(handles.cpIn, Vec2.mirror(snappedPos, anchor.position));
    }
  }

  #startSnap(editor: EditorAPI, anchor: AnchorData): void {
    this.#clearSnap();
    this.#snap = editor.createDragSnapSession({
      anchorPointId: anchor.pointId,
      dragStart: anchor.position,
      excludedPointIds: [],
    });
  }

  #clearSnap(): void {
    if (this.#snap) this.#snap.clear();
    this.#snap = null;
  }
}
