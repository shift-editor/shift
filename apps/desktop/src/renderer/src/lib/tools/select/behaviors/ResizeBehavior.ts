import type { PointId, Point2D, Rect2D } from "@shift/types";
import { Vec2 } from "@shift/geo";
import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { SelectState, SelectBehavior } from "../types";
import type { BoundingRectEdge } from "../cursor";
import { hitTestBoundingBox } from "../boundingBoxHitTest";
import { BOUNDING_BOX_HANDLE_STYLES } from "@/lib/styles/style";

export class ResizeBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    if (state.type === "resizing") {
      return event.type === "drag" || event.type === "dragEnd" || event.type === "dragCancel";
    }
    if (state.type === "selected" && event.type === "dragStart") {
      return true;
    }
    return false;
  }

  transition(state: SelectState, event: ToolEvent, editor: ToolContext): SelectState | null {
    if (state.type === "resizing") {
      return this.transitionResizing(state, event, editor);
    }

    if (state.type === "selected" && event.type === "dragStart") {
      return this.tryStartResize(state, event, editor);
    }

    return null;
  }

  onTransition(prev: SelectState, next: SelectState, event: ToolEvent, editor: ToolContext): void {
    if (prev.type !== "resizing" && next.type === "resizing") {
      editor.beginPreview();
      editor.clearHover();
    }
    if (prev.type === "resizing" && next.type !== "resizing") {
      if (event.type !== "dragEnd") {
        editor.cancelPreview();
      }
    }
  }

  private transitionResizing(
    state: SelectState & { type: "resizing" },
    event: ToolEvent,
    editor: ToolContext,
  ): SelectState {
    if (event.type === "drag") {
      const uniformScale = event.shiftKey;
      const { sx, sy } = this.calculateScaleFactors(
        state.resize.edge,
        event.point,
        state.resize.anchorPoint,
        state.resize.initialBounds,
        uniformScale,
      );

      const moves: Array<{ id: PointId; x: number; y: number }> = [];
      for (const [id, initialPos] of state.resize.initialPositions) {
        const anchor = state.resize.anchorPoint;
        const offset = Vec2.sub(initialPos, anchor);
        const scaled = Vec2.mul(offset, { x: sx, y: sy });
        const newPos = Vec2.add(anchor, scaled);
        moves.push({ id, x: newPos.x, y: newPos.y });
      }
      editor.setPointPositions(moves);

      return {
        type: "resizing",
        resize: {
          ...state.resize,
          lastPos: event.point,
          uniformScale,
        },
      };
    }

    if (event.type === "dragEnd") {
      const { sx, sy } = this.calculateScaleFactors(
        state.resize.edge,
        state.resize.lastPos,
        state.resize.anchorPoint,
        state.resize.initialBounds,
        state.resize.uniformScale,
      );

      return {
        type: "selected",
        intent: {
          action: "scalePoints",
          pointIds: state.resize.draggedPointIds,
          sx,
          sy,
          anchor: state.resize.anchorPoint,
        },
      };
    }

    if (event.type === "dragCancel") {
      return {
        type: "selected",
        intent: { action: "cancelPreview" },
      };
    }

    return state;
  }

  private tryStartResize(
    _state: SelectState & { type: "selected" },
    event: ToolEvent & { type: "dragStart" },
    editor: ToolContext,
  ): SelectState | null {
    const point = editor.getPointAt(event.point);
    if (point) return null;

    const edge = this.hitTestBoundingRectEdge(event.point, editor);
    const bounds = editor.getSelectionBoundingRect();

    if (!edge || !bounds) return null;

    const anchorPoint = this.getAnchorPointForEdge(edge, bounds);
    const draggedPointIds = [...editor.getSelectedPoints()];

    const initialPositions = new Map<PointId, Point2D>();
    const glyph = editor.getGlyph();
    const allPoints = glyph?.contours.flatMap((c) => c.points) ?? [];
    for (const p of allPoints) {
      if (editor.isPointSelected(p.id)) {
        initialPositions.set(p.id, { x: p.x, y: p.y });
      }
    }

    return {
      type: "resizing",
      resize: {
        edge,
        startPos: event.point,
        lastPos: event.point,
        initialBounds: bounds,
        anchorPoint,
        draggedPointIds,
        initialPositions,
        uniformScale: false,
      },
    };
  }

  private hitTestBoundingRectEdge(pos: Point2D, editor: ToolContext): BoundingRectEdge {
    const rect = editor.getSelectionBoundingRect();
    if (!rect) return null;

    const hitRadius = editor.hitRadius;
    const handleOffset = editor.screenToUpmDistance(BOUNDING_BOX_HANDLE_STYLES.handle.offset);
    const rotationZoneOffset = editor.screenToUpmDistance(
      BOUNDING_BOX_HANDLE_STYLES.rotationZoneOffset,
    );

    const result = hitTestBoundingBox(pos, rect, hitRadius, handleOffset, rotationZoneOffset);

    if (result?.type === "resize") {
      return result.edge;
    }

    return null;
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
