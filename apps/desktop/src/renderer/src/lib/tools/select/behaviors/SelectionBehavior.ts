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

    // Point hit + shift toggle
    if (pointId !== null && state.type === "selected" && event.shiftKey) {
      const selectedPoints = editor.getSelectedPoints();
      const isSelected = editor.isPointSelected(pointId);
      const willHaveSelection =
        editor.hasSelection() && !(isSelected && selectedPoints.length === 1);
      const type = willHaveSelection || !isSelected ? "selected" : "ready";
      return { type, intent: { action: "togglePoint", pointId } };
    }

    if (pointId !== null) {
      return {
        type: "selected",
        intent: { action: "selectPoint", pointId, additive: event.shiftKey },
      };
    }

    // Segment hit + shift toggle
    if (hit !== null && isSegmentHit(hit) && state.type === "selected" && event.shiftKey) {
      const selectedPoints = editor.getSelectedPoints();
      const selectedSegments = editor.getSelectedSegments();
      const isSelected = editor.isSegmentSelected(hit.segmentId);
      const hasOtherSelections =
        selectedPoints.length > 0 ||
        selectedSegments.length > 1 ||
        (selectedSegments.length === 1 && !isSelected);
      const type = hasOtherSelections || !isSelected ? "selected" : "ready";
      return { type, intent: { action: "toggleSegment", segmentId: hit.segmentId } };
    }

    // Segment hit (no shift)
    if (hit !== null && isSegmentHit(hit)) {
      return {
        type: "selected",
        intent: {
          action: "selectSegment",
          segmentId: hit.segmentId,
          additive: event.shiftKey,
        },
      };
    }

    // Clear selection if anything is selected
    if (state.type === "selected" || editor.hasSelection()) {
      return { type: "ready", intent: { action: "clearSelection" } };
    }

    return null;
  }
}
