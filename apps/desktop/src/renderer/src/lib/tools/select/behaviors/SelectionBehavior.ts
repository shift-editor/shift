import type { ToolEvent } from "../../core/GestureDetector";
import type { Editor } from "@/lib/editor";
import type { SelectState, SelectBehavior } from "../types";

export class SelectionBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    return (state.type === "ready" || state.type === "selected") && event.type === "click";
  }

  transition(state: SelectState, event: ToolEvent, editor: Editor): SelectState | null {
    if (event.type !== "click") return null;
    if (state.type !== "ready" && state.type !== "selected") return null;

    const point = editor.hitTest.getPointAt(event.point);

    if (point) {
      const pointId = point.id;
      if (state.type === "selected" && event.shiftKey) {
        const hasSelection = editor.selection.hasSelection();
        const isSelected = editor.selection.isPointSelected(pointId);
        const willHaveSelection =
          hasSelection && !(isSelected && editor.selection.getSelectedPointsCount() === 1);

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

    const segmentHit = editor.hitTest.getSegmentAt(event.point);
    if (segmentHit) {
      if (state.type === "selected" && event.shiftKey) {
        const isSelected = editor.selection.isSegmentSelected(segmentHit.segmentId);
        const hasOtherSelections =
          editor.selection.getSelectedPointsCount() > 0 ||
          editor.selection.getSelectedSegmentsCount() > 1 ||
          (editor.selection.getSelectedSegmentsCount() === 1 && !isSelected);

        if (hasOtherSelections || !isSelected) {
          return {
            type: "selected",
            hoveredPointId: null,
            intent: {
              action: "toggleSegment",
              segmentId: segmentHit.segmentId,
            },
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
        intent: {
          action: "selectSegment",
          segmentId: segmentHit.segmentId,
          additive: event.shiftKey,
        },
      };
    }

    if (state.type === "selected") {
      return {
        type: "ready",
        hoveredPointId: null,
        intent: { action: "clearSelection" },
      };
    }

    if (state.type === "ready" && editor.selection.hasSelection()) {
      return {
        ...state,
        hoveredPointId: null,
        intent: { action: "clearSelection" },
      };
    }

    return null;
  }
}
