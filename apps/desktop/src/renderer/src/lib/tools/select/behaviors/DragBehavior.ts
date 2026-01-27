import { Vec2 } from "@shift/geo";
import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/createContext";
import type { SelectState, SelectBehavior } from "../types";
import { Segment as SegmentOps } from "@/lib/geo/Segment";

export class DragBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    if (state.type === "dragging") {
      return event.type === "drag" || event.type === "dragEnd" || event.type === "dragCancel";
    }
    if ((state.type === "ready" || state.type === "selected") && event.type === "dragStart") {
      return true;
    }
    return false;
  }

  transition(
    state: SelectState,
    event: ToolEvent,
    ctx: ToolContext,
  ): SelectState | null {
    if (state.type === "dragging") {
      return this.transitionDragging(state, event);
    }

    if ((state.type === "ready" || state.type === "selected") && event.type === "dragStart") {
      return this.tryStartDrag(state, event, ctx);
    }

    return null;
  }

  onTransition(
    prev: SelectState,
    next: SelectState,
    _event: ToolEvent,
    ctx: ToolContext,
  ): void {
    if (prev.type !== "dragging" && next.type === "dragging") {
      ctx.preview.beginPreview();
    }
  }

  private transitionDragging(
    state: SelectState & { type: "dragging" },
    event: ToolEvent,
  ): SelectState {
    if (event.type === "drag") {
      const delta = Vec2.sub(event.point, state.drag.lastPos);
      return {
        type: "dragging",
        drag: {
          ...state.drag,
          lastPos: event.point,
          totalDelta: Vec2.add(state.drag.totalDelta, delta),
        },
        intent: { action: "movePointsDelta", delta },
      };
    }

    if (event.type === "dragEnd") {
      const { totalDelta, draggedPointIds } = state.drag;
      const hasMoved = (totalDelta.x !== 0 || totalDelta.y !== 0) && draggedPointIds.length > 0;

      return {
        type: "selected",
        hoveredPointId: null,
        intent: hasMoved
          ? { action: "commitPreview", label: "Move Points" }
          : { action: "cancelPreview" },
      };
    }

    if (event.type === "dragCancel") {
      return {
        type: "selected",
        hoveredPointId: null,
        intent: { action: "cancelPreview" },
      };
    }

    return state;
  }

  private tryStartDrag(
    state: SelectState & { type: "ready" | "selected" },
    event: ToolEvent & { type: "dragStart" },
    ctx: ToolContext,
  ): SelectState | null {
    const pointId = ctx.hitTest.getPointIdAt(event.point);

    if (pointId) {
      const isSelected = state.type === "selected" && ctx.selection.isPointSelected(pointId);
      const draggedPointIds = isSelected
        ? [...ctx.selection.getSelectedPoints()]
        : [pointId];

      return {
        type: "dragging",
        drag: {
          anchorPointId: pointId,
          startPos: event.point,
          lastPos: event.point,
          totalDelta: { x: 0, y: 0 },
          draggedPointIds,
        },
        intent: isSelected
          ? undefined
          : { action: "selectPoint", pointId, additive: false },
      };
    }

    const segmentHit = ctx.hitTest.getSegmentAt(event.point);
    if (segmentHit) {
      const segment = ctx.hitTest.findSegmentById(segmentHit.segmentId);
      const pointIds = segment ? SegmentOps.getPointIds(segment) : [];

      const isSelected = state.type === "selected" && ctx.selection.isSegmentSelected(segmentHit.segmentId);
      const draggedPointIds = isSelected
        ? [...ctx.selection.getSelectedPoints()]
        : pointIds;

      return {
        type: "dragging",
        drag: {
          anchorPointId: draggedPointIds[0],
          startPos: event.point,
          lastPos: event.point,
          totalDelta: { x: 0, y: 0 },
          draggedPointIds,
        },
        intent: isSelected
          ? undefined
          : { action: "selectSegment", segmentId: segmentHit.segmentId, additive: false },
      };
    }

    return null;
  }
}
