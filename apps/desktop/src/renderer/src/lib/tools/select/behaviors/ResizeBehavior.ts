import type { Point2D, Rect2D } from "@shift/types";
import { Vec2 } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { EditorAPI } from "../../core/EditorAPI";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectHandlerBehavior, SelectState } from "../types";
import type { BoundingRectEdge } from "../cursor";

export class ResizeBehavior implements SelectHandlerBehavior {
  onDragStart(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"dragStart">,
  ): boolean {
    if (state.type !== "selected") return false;

    const next = this.tryStartResize(event, ctx.editor);
    if (!next) return false;

    ctx.setState(next);
    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState>, event: ToolEventOf<"drag">): boolean {
    if (state.type !== "resizing") return false;
    const next = this.nextResizingState(state, event);
    ctx.setState(next);
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "resizing") return false;
    state.resize.session.commit();
    ctx.setState({ type: "selected" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "resizing") return false;
    state.resize.session.cancel();
    ctx.setState({ type: "selected" });
    return true;
  }

  onStateEnter(prev: SelectState, next: SelectState, ctx: ToolContext<SelectState>): void {
    const editor = ctx.editor;
    if (prev.type !== "resizing" && next.type === "resizing") {
      editor.clearHover();
    }
  }

  private nextResizingState(state: SelectState, event: ToolEventOf<"drag">): SelectState {
    if (state.type !== "resizing") return state;

    const uniformScale = event.shiftKey;
    const currentPos = event.coords.glyphLocal;
    const { sx, sy } = this.calculateScaleFactors(
      state.resize.edge,
      currentPos,
      state.resize.anchorPoint,
      state.resize.initialBounds,
      uniformScale,
    );

    state.resize.session.update(sx, sy, currentPos, {
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey ?? false,
    });

    return {
      type: "resizing",
      resize: {
        ...state.resize,
        lastPos: currentPos,
        uniformScale,
      },
    };
  }

  private tryStartResize(event: ToolEventOf<"dragStart">, editor: EditorAPI): SelectState | null {
    const point = editor.getPointAt(event.coords);
    if (point) return null;

    const bbHit = editor.hitTestBoundingBoxAt(event.coords);
    if (!bbHit) return null;

    const edge: BoundingRectEdge = bbHit.type === "resize" ? bbHit.edge : null;
    const bounds = editor.getSelectionBoundingRect();

    if (!edge || !bounds) return null;

    const localPoint = event.coords.glyphLocal;
    const anchorPoint = this.getAnchorPointForEdge(edge, bounds);
    const session = editor.beginResizeDrag(
      {
        pointIds: editor.getSelectedPoints(),
        anchorIds: editor.getSelectedAnchors(),
      },
      anchorPoint,
      localPoint,
      { label: "Scale Points" },
    );

    return {
      type: "resizing",
      resize: {
        session,
        edge,
        startPos: localPoint,
        lastPos: localPoint,
        initialBounds: bounds,
        anchorPoint,
        uniformScale: false,
      },
    };
  }

  private getAnchorPointForEdge(edge: Exclude<BoundingRectEdge, null>, rect: Rect2D): Point2D {
    const center = Vec2.midpoint({ x: rect.left, y: rect.top }, { x: rect.right, y: rect.bottom });

    switch (edge) {
      case "top-left":
        return { x: rect.right, y: rect.top };
      case "top-right":
        return { x: rect.left, y: rect.top };
      case "bottom-left":
        return { x: rect.right, y: rect.bottom };
      case "bottom-right":
        return { x: rect.left, y: rect.bottom };
      case "left":
        return { x: rect.right, y: center.y };
      case "right":
        return { x: rect.left, y: center.y };
      case "top":
        return { x: center.x, y: rect.top };
      case "bottom":
        return { x: center.x, y: rect.bottom };
    }
  }

  private calculateScaleFactors(
    edge: Exclude<BoundingRectEdge, null>,
    currentPos: Point2D,
    anchorPoint: Point2D,
    initialBounds: Rect2D,
    uniform: boolean,
  ): { sx: number; sy: number } {
    const initialWidth = initialBounds.right - initialBounds.left;
    const initialHeight = initialBounds.bottom - initialBounds.top;

    if (initialWidth === 0 || initialHeight === 0) {
      return { sx: 1, sy: 1 };
    }

    const newWidth = Math.abs(currentPos.x - anchorPoint.x);
    const newHeight = Math.abs(currentPos.y - anchorPoint.y);

    let sx = 1;
    let sy = 1;

    const isCorner = edge.includes("-");
    const affectsX = edge === "left" || edge === "right" || isCorner;
    const affectsY = edge === "top" || edge === "bottom" || isCorner;

    if (affectsX) {
      sx = newWidth / initialWidth;
    }
    if (affectsY) {
      sy = newHeight / initialHeight;
    }

    if (uniform && isCorner) {
      const uniformScale = Math.max(sx, sy);
      sx = uniformScale;
      sy = uniformScale;
    }

    let flipX = false;
    let flipY = false;

    if (edge === "left" || edge === "top-left" || edge === "bottom-left") {
      flipX = currentPos.x > anchorPoint.x;
    } else if (edge === "right" || edge === "top-right" || edge === "bottom-right") {
      flipX = currentPos.x < anchorPoint.x;
    }

    if (edge === "top-left" || edge === "top-right") {
      flipY = currentPos.y < anchorPoint.y;
    } else if (edge === "bottom-left" || edge === "bottom-right") {
      flipY = currentPos.y > anchorPoint.y;
    } else if (edge === "top") {
      flipY = currentPos.y < anchorPoint.y;
    } else if (edge === "bottom") {
      flipY = currentPos.y > anchorPoint.y;
    }

    if (flipX) sx = -sx;
    if (flipY) sy = -sy;

    return { sx, sy };
  }
}
