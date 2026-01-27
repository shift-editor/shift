import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/createContext";
import type { SelectState, SelectBehavior } from "../types";

export class SelectionBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    return (
      (state.type === "ready" || state.type === "selected") &&
      event.type === "click"
    );
  }

  transition(
    state: SelectState,
    event: ToolEvent,
    ctx: ToolContext,
  ): SelectState | null {
    if (event.type !== "click") return null;
    if (state.type !== "ready" && state.type !== "selected") return null;

    const pointId = ctx.hitTest.getPointIdAt(event.point);

    if (pointId) {
      if (state.type === "selected" && event.shiftKey) {
        const hasSelection = ctx.selection.hasSelection();
        const isSelected = ctx.selection.isPointSelected(pointId);
        const willHaveSelection = hasSelection && !(isSelected && ctx.selection.getSelectedPoints().size === 1);

        if (willHaveSelection || !isSelected) {
          return {
            type: "selected",
            hoveredPointId: pointId,
            intent: { action: "togglePoint", pointId },
          };
        }
        return {
          type: "ready",
          hoveredPointId: pointId,
          intent: { action: "togglePoint", pointId },
        };
      }

      return {
        type: "selected",
        hoveredPointId: pointId,
        intent: { action: "selectPoint", pointId, additive: event.shiftKey },
      };
    }

    const segmentHit = ctx.hitTest.getSegmentAt(event.point);
    if (segmentHit) {
      if (state.type === "selected" && event.shiftKey) {
        const isSelected = ctx.selection.isSegmentSelected(segmentHit.segmentId);
        const hasOtherSelections = ctx.selection.getSelectedPoints().size > 0 ||
          ctx.selection.getSelectedSegments().size > 1 ||
          (ctx.selection.getSelectedSegments().size === 1 && !isSelected);

        if (hasOtherSelections || !isSelected) {
          return {
            type: "selected",
            hoveredPointId: null,
            intent: { action: "toggleSegment", segmentId: segmentHit.segmentId },
          };
        }
        return {
          type: "ready",
          hoveredPointId: null,
          intent: { action: "toggleSegment", segmentId: segmentHit.segmentId },
        };
      }

      return {
        type: "selected",
        hoveredPointId: null,
        intent: { action: "selectSegment", segmentId: segmentHit.segmentId, additive: event.shiftKey },
      };
    }

    if (state.type === "selected") {
      return {
        type: "ready",
        hoveredPointId: null,
        intent: { action: "clearSelection" },
      };
    }

    return null;
  }
}
