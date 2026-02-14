import type { ToolEvent } from "../../core/GestureDetector";
import type { EditorAPI } from "../../core/EditorAPI";
import type { TransitionResult } from "../../core/Behavior";
import type { SelectState, SelectBehavior } from "../types";
import type { SelectAction } from "../actions";
import { getPointIdFromHit, isAnchorHit, isSegmentHit } from "@/types/hitResult";

function nextSelectionStateAfterToggle(
  isSelected: boolean,
  selectedInTypeCount: number,
  selectedInOtherTypesCount: number,
): "ready" | "selected" {
  const nextInTypeCount = selectedInTypeCount + (isSelected ? -1 : 1);
  return nextInTypeCount + selectedInOtherTypesCount > 0 ? "selected" : "ready";
}

export class SelectionBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    return (state.type === "ready" || state.type === "selected") && event.type === "click";
  }

  transition(
    state: SelectState,
    event: ToolEvent,
    editor: EditorAPI,
  ): TransitionResult<SelectState, SelectAction> | null {
    if (event.type !== "click") return null;
    if (state.type !== "ready" && state.type !== "selected") return null;

    const hit = editor.getNodeAt(event.coords);
    const pointId = getPointIdFromHit(hit);
    const anchorId = isAnchorHit(hit) ? hit.anchorId : null;

    // Anchor hit + shift toggle
    if (anchorId !== null && state.type === "selected" && event.shiftKey) {
      const selectedPoints = editor.getSelectedPoints();
      const selectedAnchors = editor.getSelectedAnchors();
      const selectedSegments = editor.getSelectedSegments();
      const isSelected = editor.isAnchorSelected(anchorId);
      const type = nextSelectionStateAfterToggle(
        isSelected,
        selectedAnchors.length,
        selectedPoints.length + selectedSegments.length,
      );
      return { state: { type }, action: { type: "toggleAnchor", anchorId } };
    }

    if (anchorId !== null) {
      return {
        state: { type: "selected" },
        action: { type: "selectAnchor", anchorId, additive: event.shiftKey },
      };
    }

    // Point hit + shift toggle
    if (pointId !== null && state.type === "selected" && event.shiftKey) {
      const selectedPoints = editor.getSelectedPoints();
      const selectedAnchors = editor.getSelectedAnchors();
      const selectedSegments = editor.getSelectedSegments();
      const isSelected = editor.isPointSelected(pointId);
      const type = nextSelectionStateAfterToggle(
        isSelected,
        selectedPoints.length,
        selectedAnchors.length + selectedSegments.length,
      );
      return { state: { type }, action: { type: "togglePoint", pointId } };
    }

    if (pointId !== null) {
      return {
        state: { type: "selected" },
        action: { type: "selectPoint", pointId, additive: event.shiftKey },
      };
    }

    // Segment hit + shift toggle
    if (hit !== null && isSegmentHit(hit) && state.type === "selected" && event.shiftKey) {
      const selectedPoints = editor.getSelectedPoints();
      const selectedAnchors = editor.getSelectedAnchors();
      const selectedSegments = editor.getSelectedSegments();
      const isSelected = editor.isSegmentSelected(hit.segmentId);
      const type = nextSelectionStateAfterToggle(
        isSelected,
        selectedSegments.length,
        selectedPoints.length + selectedAnchors.length,
      );
      return { state: { type }, action: { type: "toggleSegment", segmentId: hit.segmentId } };
    }

    // Segment hit (no shift)
    if (hit !== null && isSegmentHit(hit)) {
      return {
        state: { type: "selected" },
        action: {
          type: "selectSegment",
          segmentId: hit.segmentId,
          additive: event.shiftKey,
        },
      };
    }

    // Clear selection if anything is selected
    if (state.type === "selected" || editor.hasSelection()) {
      return { state: { type: "ready" }, action: { type: "clearSelection" } };
    }

    return null;
  }
}
