import type { Point2D } from "@shift/types";
import { Vec2 } from "@shift/geo";
import { Contours } from "@shift/font";
import { Validate } from "@shift/validation";
import type { ToolContext } from "../../core/Behavior";
import type { Editor } from "@/lib/editor/Editor";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { PenState, PenBehavior, AnchorData, HandleData } from "../types";
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

    if (state.type === "anchored" && !state.anchor.pointId) {
      const glyph = ctx.editor.glyph.peek();
      const contour = ctx.editor.getActiveContour();
      if (glyph && contour) {
        glyph.addPointToContour(contour.id, {
          x: state.anchor.position.x,
          y: state.anchor.position.y,
          pointType: "onCurve",
          smooth: false,
        });
      }
    }

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
    editor: Editor,
  ): (PenState & { type: "dragging" }) | null {
    const localPoint = event.coords.glyphLocal;
    if (Vec2.dist(state.anchor.position, localPoint) <= DRAG_THRESHOLD) return null;

    const handles = this.#createHandles(state.anchor, localPoint, editor);

    if (state.anchor.pointId) {
      this.#startSnap(editor, state.anchor);
    }

    let snappedPos = localPoint;
    if (this.#snap) {
      const result = this.#snap.snap(localPoint, { shiftKey: event.shiftKey });
      snappedPos = result.point;
      editor.setSnapIndicator(result.indicator);
    }

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
    editor: Editor,
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

  #createHandles(anchor: AnchorData, snappedPos: Point2D, editor: Editor): HandleData {
    const glyph = editor.glyph.peek();
    if (!glyph) return {};

    const { position } = anchor;
    const contour = editor.getActiveContour();

    if (!contour) return {};

    const prevPoint = Contours.lastPoint(contour);
    const prevOnCurve = Contours.lastOnCurvePoint(contour);
    const isFirstPoint = Contours.isEmpty(contour);

    const anchorId = glyph.addPointToContour(contour.id, {
      x: position.x,
      y: position.y,
      pointType: "onCurve",
      smooth: true,
    });
    anchor.pointId = anchorId;

    if (isFirstPoint) {
      const cpOutId = glyph.addPointToContour(contour.id, {
        x: snappedPos.x,
        y: snappedPos.y,
        pointType: "offCurve",
        smooth: false,
      });
      return { cpOut: cpOutId };
    }

    const prevIsOffCurve = prevPoint && Validate.isOffCurve(prevPoint);

    if (prevIsOffCurve) {
      const cpInPos = Vec2.mirror(snappedPos, position);
      const cpInId = glyph.insertPointBefore(anchorId, {
        x: cpInPos.x,
        y: cpInPos.y,
        pointType: "offCurve",
        smooth: false,
      });
      const cpOutId = glyph.addPointToContour(contour.id, {
        x: snappedPos.x,
        y: snappedPos.y,
        pointType: "offCurve",
        smooth: false,
      });
      return { cpIn: cpInId, cpOut: cpOutId };
    }

    if (prevOnCurve) {
      const cp1Pos = Vec2.lerp(prevOnCurve, position, 1 / 3);
      glyph.insertPointBefore(anchorId, {
        x: cp1Pos.x,
        y: cp1Pos.y,
        pointType: "offCurve",
        smooth: false,
      });
    }

    const cpInPos = Vec2.mirror(snappedPos, position);
    const cpInId = glyph.insertPointBefore(anchorId, {
      x: cpInPos.x,
      y: cpInPos.y,
      pointType: "offCurve",
      smooth: false,
    });
    return { cpIn: cpInId };
  }

  #updateHandles(
    anchor: AnchorData,
    handles: HandleData,
    snappedPos: Point2D,
    editor: Editor,
  ): void {
    const glyph = editor.glyph.peek();
    if (!glyph) return;

    if (handles.cpOut) {
      glyph.movePointTo(handles.cpOut, snappedPos.x, snappedPos.y);
    }

    if (handles.cpIn) {
      const mirror = Vec2.mirror(snappedPos, anchor.position);
      glyph.movePointTo(handles.cpIn, mirror.x, mirror.y);
    }
  }

  #startSnap(editor: Editor, anchor: AnchorData): void {
    if (!anchor.pointId) return;

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
