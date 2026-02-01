import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { SelectState, SelectBehavior } from "../types";
import { getPointIdFromHit, isSegmentHit } from "@/types/hitResult";

export class SelectionBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    return (state.type === "ready" || state.type === "selected") && event.type === "click";
  }

  transition(state: SelectState, event: ToolEvent, editor: ToolContext): SelectState | null {
    if (event.type !== "click") return null;
    if (state.type !== "ready" && state.type !== "selected") return null;

    const hit = editor.getNodeAt(event.point);
    const pointId = getPointIdFromHit(hit);

    if (pointId !== null) {
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

    if (hit !== null && isSegmentHit(hit)) {
      if (state.type === "selected" && event.shiftKey) {
        const isSelected = editor.isSegmentSelected(hit.segmentId);
        const hasOtherSelections =
          editor.getSelectedPointsCount() > 0 ||
          editor.getSelectedSegmentsCount() > 1 ||
          (editor.getSelectedSegmentsCount() === 1 && !isSelected);

        if (hasOtherSelections || !isSelected) {
          return {
            type: "selected",
            intent: {
              action: "toggleSegment",
              segmentId: hit.segmentId,
            },
          };
        }
        return {
          type: "ready",
          intent: { action: "toggleSegment", segmentId: hit.segmentId },
        };
      }

      return {
        type: "selected",
        intent: {
          action: "selectSegment",
          segmentId: hit.segmentId,
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
