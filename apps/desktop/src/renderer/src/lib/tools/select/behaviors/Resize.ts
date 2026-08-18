import { Bounds, Vec2, type Point2D, type Rect2D } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { DragEvent, DragStartEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import type { Select } from "../Select";
import type { BoundingRectEdge } from "../cursor";
import type { ScaleEdit } from "@/lib/model/positions";
import { GlyphLayerPositionList } from "@/lib/model/GlyphLayerPositionList";

export class Resize implements SelectBehavior {
  #edit: ScaleEdit | null = null;

  onDragStart(
    _state: SelectState,
    ctx: ToolContext<SelectState, Select>,
    event: DragStartEvent,
  ): boolean {
    if (!ctx.editor.selection.hasSelection()) return false;

    const hit = ctx.tool.boundingBox.hit(event.origin);
    if (hit?.type !== "resize") return false;

    const selection = ctx.editor.positionSelection(ctx.editor.selection.ids);
    if (!selection) return false;

    const localPositions = GlyphLayerPositionList.fromTargetGroups(
      selection.layer,
      selection.targets,
    ).positions;
    const localBounds = Bounds.fromPoints(localPositions);
    if (!localBounds) return false;

    const edge = hit.edge;
    const startPos = event.origin.scene;
    const anchorPoint = this.getAnchorPointForEdge(edge, hit.rect);
    const localAnchorPoint = this.getAnchorPointForEdge(edge, Bounds.toRect(localBounds));

    this.#edit = selection.layer.positions.scale(selection.targets, localAnchorPoint);

    ctx.setState({
      type: "resizing",
      resize: {
        edge,
        startPos,
        lastPos: startPos,
        initialBounds: hit.rect,
        anchorPoint,
        uniformScale: false,
      },
    });

    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState, Select>, event: DragEvent): boolean {
    if (state.type !== "resizing") return false;
    if (!this.#edit) return false;

    const next = this.nextResizingState(state, event);
    ctx.setState(next);
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState, Select>): boolean {
    if (state.type !== "resizing") return false;

    this.#edit?.commit();
    this.#cleanup();

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState, Select>): boolean {
    if (state.type !== "resizing") return false;

    this.#edit?.discard();
    this.#cleanup();

    ctx.setState({ type: "ready" });
    return true;
  }

  onStateEnter(prev: SelectState, next: SelectState, ctx: ToolContext<SelectState, Select>): void {
    const editor = ctx.editor;
    if (prev.type !== "resizing" && next.type === "resizing") {
      editor.hover.clear();
    }
  }

  #cleanup(): void {
    this.#edit = null;
  }

  private nextResizingState(state: SelectState, event: DragEvent): SelectState {
    if (state.type !== "resizing") return state;
    if (!this.#edit) return state;

    const uniformScale = event.shiftKey;
    const currentPos = event.coords.scene;
    const { sx, sy } = this.calculateScaleFactors(
      state.resize.edge,
      currentPos,
      state.resize.anchorPoint,
      state.resize.initialBounds,
      uniformScale,
    );

    this.#edit.preview({ x: sx, y: sy });

    return {
      type: "resizing",
      resize: {
        ...state.resize,
        lastPos: currentPos,
        uniformScale,
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

    if (affectsX) sx = newWidth / initialWidth;
    if (affectsY) sy = newHeight / initialHeight;

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
