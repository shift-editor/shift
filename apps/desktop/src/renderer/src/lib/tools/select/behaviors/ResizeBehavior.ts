import type { GlyphSnapshot, Point2D, Rect2D } from "@shift/types";
import { Vec2 } from "@shift/geo";
import { Glyphs } from "@shift/font";
import type { ToolContext } from "../../core/Behavior";
import type { Editor } from "@/lib/editor/Editor";
import type { DragTarget } from "../../core/EditorAPI";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectHandlerBehavior, SelectState } from "../types";
import type { BoundingRectEdge } from "../cursor";
import type { GlyphDraft } from "@/types/draft";
import type { NodePositionUpdateList } from "@/types/positionUpdate";

export class ResizeBehavior implements SelectHandlerBehavior {
  #draft: GlyphDraft | null = null;
  #target: DragTarget | null = null;
  #origin: Point2D | null = null;

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
    if (!this.#draft || !this.#target || !this.#origin) return false;

    const next = this.nextResizingState(state, event);
    ctx.setState(next);
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "resizing") return false;
    this.#draft?.finish("Scale Points");
    this.#cleanup();
    ctx.setState({ type: "selected" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "resizing") return false;
    this.#draft?.discard();
    this.#cleanup();
    ctx.setState({ type: "selected" });
    return true;
  }

  onStateEnter(prev: SelectState, next: SelectState, ctx: ToolContext<SelectState>): void {
    const editor = ctx.editor;
    if (prev.type !== "resizing" && next.type === "resizing") {
      editor.clearHover();
    }
  }

  #cleanup(): void {
    this.#draft = null;
    this.#target = null;
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

    const updates = buildResizeUpdates(this.#draft!.base, this.#target!, this.#origin!, sx, sy);
    this.#draft!.setPositions(updates);

    return {
      type: "resizing",
      resize: {
        ...state.resize,
        lastPos: currentPos,
        uniformScale,
      },
    };
  }

  private tryStartResize(event: ToolEventOf<"dragStart">, editor: Editor): SelectState | null {
    const hit = editor.hitTest(event.coords);
    if (hit?.type === "point") return null;

    const bbHit = editor.hitTestBoundingBoxAt(event.coords);
    if (!bbHit) return null;

    const edge: BoundingRectEdge = bbHit.type === "resize" ? bbHit.edge : null;
    const bounds = editor.getSelectionBoundingRect();

    if (!edge || !bounds) return null;

    const localPoint = event.coords.glyphLocal;
    const anchorPoint = this.getAnchorPointForEdge(edge, bounds);

    this.#draft = editor.createDraft();
    this.#target = {
      pointIds: [...editor.selection.pointIds],
      anchorIds: [...editor.selection.anchorIds],
    };
    this.#origin = anchorPoint;

    return {
      type: "resizing",
      resize: {
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

function scaleAround(point: Point2D, origin: Point2D, scaleX: number, scaleY: number): Point2D {
  const offset = Vec2.sub(point, origin);
  return Vec2.add(origin, {
    x: offset.x * scaleX,
    y: offset.y * scaleY,
  });
}

function buildResizeUpdates(
  base: GlyphSnapshot,
  target: DragTarget,
  origin: Point2D,
  scaleX: number,
  scaleY: number,
): NodePositionUpdateList {
  const updates: Array<NodePositionUpdateList[number]> = [];

  for (const point of Glyphs.findPoints(base, target.pointIds)) {
    const next = scaleAround(point, origin, scaleX, scaleY);
    updates.push({
      node: { kind: "point", id: point.id },
      x: next.x,
      y: next.y,
    });
  }

  for (const anchorId of target.anchorIds) {
    const anchor = base.anchors.find((item) => item.id === anchorId);
    if (!anchor) continue;
    const next = scaleAround(anchor, origin, scaleX, scaleY);
    updates.push({
      node: { kind: "anchor", id: anchorId },
      x: next.x,
      y: next.y,
    });
  }

  return updates;
}
