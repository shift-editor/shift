import { Vec2, type Point2D, type Rect2D } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import type { BoundingRectEdge } from "../cursor";
import type { GlyphLayerEditDraft } from "@/lib/editor/GlyphLayerEditDraft";
import type { Select } from "../Select";

export class Resize implements SelectBehavior {
  #draft: GlyphLayerEditDraft | null = null;
  #origin: Point2D | null = null;

  onDragStart(
    _state: SelectState,
    ctx: ToolContext<SelectState, Select>,
    event: ToolEventOf<"dragStart">,
  ): boolean {
    if (!ctx.editor.selection.hasSelection()) return false;

    const editor = ctx.editor;
    if (!editor.previewGlyphInstance || !editor.editingGlyphLayer) return false;

    const bbHit = ctx.tool.boundingBox.hit(event.coords);
    if (!bbHit) return false;

    if (bbHit.type !== "resize") return false;
    const bounds = bbHit.rect;

    const edge = bbHit.edge;
    const localPoint = event.coords.glyphLocal;
    const anchorPoint = this.getAnchorPointForEdge(edge, bounds);

    this.#draft = editor.beginGlyphLayerEditDraft({
      points: [...editor.selection.pointIds],
      anchors: [...editor.selection.anchorIds],
    });
    this.#origin = anchorPoint;

    ctx.setState({
      type: "resizing",
      resize: {
        edge,
        startPos: localPoint,
        lastPos: localPoint,
        initialBounds: bounds,
        anchorPoint,
        uniformScale: false,
      },
    });

    return true;
  }

  onDrag(
    state: SelectState,
    ctx: ToolContext<SelectState, Select>,
    event: ToolEventOf<"drag">,
  ): boolean {
    if (state.type !== "resizing") return false;
    if (!this.#draft || !this.#origin) return false;

    const next = this.nextResizingState(state, event);
    ctx.setState(next);
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState, Select>): boolean {
    if (state.type !== "resizing") return false;

    this.#draft?.commit();
    this.#cleanup();

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState, Select>): boolean {
    if (state.type !== "resizing") return false;

    this.#draft?.discard();
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
    this.#draft = null;
    this.#origin = null;
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

    this.#draft!.previewScale(sx, sy, this.#origin!);

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
