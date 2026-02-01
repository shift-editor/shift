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

    const point = editor.getPointAt(event.point);

    if (point) {
      const pointId = point.id;
      if (state.type === "selected" && event.shiftKey) {
        const hasSelection = editor.hasSelection();
        const isSelected = editor.isPointSelected(pointId);
        const willHaveSelection =
          hasSelection && !(isSelected && editor.getSelectedPointsCount() === 1);

        if (willHaveSelection || !isSelected) {
          return {
            type: "selected",
            intent: { action: "togglePoint", pointId },
          };
        }
        return {
          type: "ready",
          intent: { action: "togglePoint", pointId },
        };
      }

      return {
        type: "selected",
        intent: { action: "selectPoint", pointId, additive: event.shiftKey },
      };
    }

    const segmentHit = editor.getSegmentAt(event.point);
    if (segmentHit) {
      if (state.type === "selected" && event.shiftKey) {
        const isSelected = editor.isSegmentSelected(segmentHit.segmentId);
        const hasOtherSelections =
          editor.getSelectedPointsCount() > 0 ||
          editor.getSelectedSegmentsCount() > 1 ||
          (editor.getSelectedSegmentsCount() === 1 && !isSelected);

        if (hasOtherSelections || !isSelected) {
          return {
            type: "selected",
            intent: {
              action: "toggleSegment",
              segmentId: segmentHit.segmentId,
            },
          };
        }
        return {
          type: "ready",
          intent: { action: "toggleSegment", segmentId: segmentHit.segmentId },
        };
      }

      return {
        type: "selected",
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
        intent: { action: "clearSelection" },
      };
    }

    if (state.type === "ready" && editor.hasSelection()) {
      return {
        ...state,
        intent: { action: "clearSelection" },
      };
    }

    return null;
  }
}
